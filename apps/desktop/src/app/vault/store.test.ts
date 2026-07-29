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
  flushActiveNote,
  noteEdited,
  openNote,
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
function installBridge(options: { holdFirstWrite?: boolean; failWrites?: boolean } = {}) {
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
