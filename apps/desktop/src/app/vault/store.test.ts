/**
 * Save-path regressions.
 *
 * These cover the ways the autosave state machine has silently destroyed
 * writing: text from one note landing in another, keystrokes reverted on
 * screen mid-sentence, and autosave quietly switching itself off. Each test
 * drives the real store against a fake vault bridge.
 *
 * @vitest-environment jsdom
 */

import assert from 'node:assert/strict'
import { beforeEach, test } from 'vitest'

import {
  $activeDirty,
  $activeNote,
  $vaultRescued,
  $vaultSaveError,
  flushActiveNote,
  ICLOUD_DOWNLOAD_PENDING,
  noteEdited,
  openNote,
  rescuedText,
  resetSaveState
} from './store'

interface FakeFile {
  content: string
  mtimeMs: number
}

let disk: Record<string, FakeFile>
let writes: Array<{ path: string; content: string }>
/** Resolves the held write, letting a test keep one save "in flight". */
let releaseWrite: (() => void) | null = null

/**
 * `holdFirstWrite` parks only the FIRST write — the real scenario is one save
 * on the wire while the user keeps typing; later saves must run normally or
 * the test can never observe the recovery.
 */
function installBridge(options: { holdFirstWrite?: boolean; failWrites?: boolean; unreadable?: boolean } = {}) {
  disk = {
    'A.md': { content: 'A original', mtimeMs: 1 },
    'B.md': { content: 'IMPORTANT NOTE B', mtimeMs: 1 }
  }
  writes = []
  releaseWrite = null

  let held = false

  const vault = {
    read: async (path: string) => ({
      path,
      content: disk[path]?.content ?? '',
      mtimeMs: disk[path]?.mtimeMs ?? 0,
      dataless: false
    }),
    write: async (path: string, content: string, expectedMtimeMs: number | null) => {
      writes.push({ path, content })

      if (options.holdFirstWrite && !held) {
        held = true

        await new Promise<void>(resolve => {
          releaseWrite = resolve
        })
      }

      if (options.failWrites) {
        throw new Error('EACCES: read-only volume')
      }

      // The note's text is still coming down from iCloud, so the main process
      // refused rather than write over bytes nobody has read.
      if (options.unreadable) {
        return { ok: false as const, reason: 'unreadable' as const }
      }

      const existing = disk[path]

      if (existing && expectedMtimeMs !== null && existing.mtimeMs !== expectedMtimeMs) {
        return { ok: false as const, reason: 'conflict' as const, conflictPath: `${path} (conflict)` }
      }

      disk[path] = { content, mtimeMs: (existing?.mtimeMs ?? 0) + 1 }

      return { ok: true as const, mtimeMs: disk[path].mtimeMs }
    },
    createNote: async (path: string) => ({ path, content: '', mtimeMs: 0, dataless: false, created: true }),
    list: async () => [],
    info: async () => ({ root: '/vault', name: 'vault', noteCount: 2, location: 'local', indexing: false })
  }

  // @ts-expect-error — test double for the preload bridge.
  window.hermesDesktop = { vault }
}

beforeEach(() => {
  // The store keeps module-level save state, so a test that leaves an edit
  // buffered (or a write held open) would hand it to the next one.
  releaseWrite?.()
  resetSaveState()
  installBridge()
  $activeNote.set(null)
})

test("one note's unsaved text is never written into another note", async () => {
  // The failure this guards: $activeNote.set() notifies SYNCHRONOUSLY, and a
  // subscriber calls back into the save path — inline AI does exactly this
  // when it cancels a run on note change. If the pending buffer still held
  // the previous note's text at that moment, it was written to the new note's
  // path, passing every conflict check because the guards came from the new
  // note's fresh read.
  //
  // The subscriber below stands in for that real one, so the test fails if the
  // ordering inside openNote regresses regardless of who the subscriber is.
  installBridge({ failWrites: true })

  const unsubscribe = $activeNote.subscribe(() => {
    void flushActiveNote()
  })

  try {
    await openNote('A.md')
    noteEdited('A typed something')

    // Saving A fails (read-only volume), so the text stays pending.
    await flushActiveNote()

    await openNote('B.md')
    await flushActiveNote()

    assert.equal(disk['B.md'].content, 'IMPORTANT NOTE B', "note B's content was overwritten")
    assert.ok(
      !writes.some(write => write.path === 'B.md' && write.content.includes('A typed')),
      `A's text was written to B: ${JSON.stringify(writes)}`
    )

    // Not landing in B is only half of it. It has to still exist somewhere —
    // this assertion is what was missing, and the buffer was simply dropped.
    assert.deepEqual($vaultRescued.get(), ['A.md'])
    assert.equal(rescuedText('A.md'), 'A typed something')
  } finally {
    unsubscribe()
  }
})

test('keystrokes typed during a save are not reverted', async () => {
  installBridge({ holdFirstWrite: true })

  await openNote('A.md')
  noteEdited('hello world')

  const inFlight = flushActiveNote()

  // The user keeps typing while the write is on the wire.
  noteEdited('hello world, and more that I just typed')

  releaseWrite?.()
  await inFlight

  // The store may record what reached disk, but the newer text must still be
  // pending and the note must still read as dirty — that flag is what stops
  // the editor replacing the user's sentence with the older one.
  assert.equal($activeDirty.get(), true, 'newer keystrokes must still count as unsaved')

  await flushActiveNote()

  assert.equal(disk['A.md'].content, 'hello world, and more that I just typed')
})

test('autosave keeps saving after a debounce fires mid-write', async () => {
  installBridge({ holdFirstWrite: true })

  await openNote('A.md')
  noteEdited('v1')

  const first = flushActiveNote()

  noteEdited('v2')

  // A second caller (note switch, unmount, the debounce) arrives while the
  // first write is still in flight and must not conclude "already saved".
  const second = flushActiveNote()

  releaseWrite?.()
  await Promise.all([first, second])
  await flushActiveNote()

  assert.equal(disk['A.md'].content, 'v2', 'the newer text never reached disk')
})

test('switching notes flushes the current one first', async () => {
  await openNote('A.md')
  noteEdited('edited before switching')

  await openNote('B.md')

  assert.equal(disk['A.md'].content, 'edited before switching')
  assert.equal($activeNote.get()?.path, 'B.md')
  assert.equal($activeDirty.get(), false)
})

test('a conflict reloads disk truth instead of looping', async () => {
  await openNote('A.md')
  noteEdited('my version')

  // Someone else (agent, another device) writes the file first.
  disk['A.md'] = { content: 'their version', mtimeMs: 99 }

  await flushActiveNote()

  assert.equal($activeNote.get()?.content, 'their version')
  assert.equal($activeDirty.get(), false)
})

test('a save refused while iCloud downloads keeps the text and says why', async () => {
  /*
   * The main process refuses to write over a note whose current bytes it could
   * not read — otherwise the empty document an evicted note opens as replaces
   * the real one on every device.
   *
   * That refusal is transient, so it must not be handled like a conflict: no
   * conflict copy was made and nothing was written, so reloading disk truth
   * here would throw the user's typing away. Hold it and retry.
   */
  installBridge({ unreadable: true })

  await openNote('A.md')
  noteEdited('what I just typed')

  await flushActiveNote()

  assert.equal($activeDirty.get(), true, 'the text is still unsaved, and must still count as such')
  assert.equal($vaultSaveError.get(), ICLOUD_DOWNLOAD_PENDING)
  assert.equal($activeNote.get()?.content, 'A original', 'nothing was adopted from disk')
  assert.equal(disk['A.md'].content, 'A original', 'and nothing was written')

  // iCloud finishes; the retry that was already armed now lands.
  installBridge()
  await flushActiveNote()

  assert.equal(disk['A.md'].content, 'what I just typed')
  assert.equal($vaultSaveError.get(), null)
})

test('text that could not be saved comes back when the note is reopened', async () => {
  /*
   * The whole loss took four steps and no error: type into A, the save fails
   * (offline volume, unplugged drive), click B, and the buffer that still held
   * A's text was cleared on the way. The dirty dot moved on with B, so nothing
   * on screen suggested anything had been lost.
   */
  installBridge({ failWrites: true })

  await openNote('A.md')
  noteEdited('the paragraph I actually wrote')
  await flushActiveNote()

  await openNote('B.md')

  assert.deepEqual($vaultRescued.get(), ['A.md'], 'the text has to be held somewhere')

  // The volume comes back.
  const saved = { ...disk }

  installBridge()
  disk = saved

  await openNote('A.md')

  assert.equal($activeNote.get()?.content, 'A original', 'the store still tracks disk truth')
  assert.equal(rescuedText('A.md'), 'the paragraph I actually wrote', 'and the editor is handed the real text')
})

test('a note whose save finally lands stops being held', async () => {
  installBridge({ failWrites: true })

  await openNote('A.md')
  noteEdited('eventually saved')
  await flushActiveNote()

  assert.deepEqual($vaultRescued.get(), ['A.md'])

  const saved = { ...disk }

  installBridge()
  disk = saved

  await flushActiveNote()

  assert.equal(disk['A.md'].content, 'eventually saved')
  assert.deepEqual($vaultRescued.get(), [], 'nothing left to hold once it is on disk')
})
