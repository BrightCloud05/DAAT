/**
 * When the model's answer actually arrives.
 *
 * `prompt.submit` does not wait for the model. The gateway starts the turn and
 * answers `{"status": "streaming"}` straight away (tui_gateway/server.py:1500);
 * the reply comes later, as `message.delta` frames and a closing
 * `message.complete`.
 *
 * runInlineAi used to read that immediate reply as "generation is nearly done"
 * and armed a 1.5-second timer to tear the run down. Every provider is slower
 * than that. On a streaming provider it truncated the output mid-sentence; on
 * openai-codex — which sends no deltas at all and only `message.complete` —
 * the subscription was gone before the single frame carrying the entire answer
 * arrived, so "Rewrite" and "Make shorter" did nothing whatsoever. No error, no
 * spinner left behind: the note simply never changed.
 *
 * The function had no test of any kind. These cover the part that talks to the
 * gateway, because that is the part that was broken.
 */

import assert from 'node:assert/strict'

import { EditorState } from '@codemirror/state'
import { atom } from 'nanostores'
import { afterEach, beforeEach, test, vi } from 'vitest'

const $editorView = atom<unknown>(null)
const $activeNote = atom<unknown>({ path: 'Note.md' })
const $vaultInfo = atom<unknown>({ root: '/vault' })

vi.mock('@/hermes', () => ({ PROMPT_SUBMIT_REQUEST_TIMEOUT_MS: 1_800_000 }))
vi.mock('../vault/editor-bridge', () => ({ $editorView }))
vi.mock('../vault/store', () => ({ $activeNote, $vaultInfo, flushActiveNote: async () => {} }))

let emit: (event: { session_id: string; type: string; payload?: unknown }) => void = () => {}
let submitted = 0
let interrupted = 0
/** Parks session.create so a test can act during the thirty seconds it allows. */
let releaseSession: (() => void) | null = null

vi.mock('@/store/gateway', () => ({
  activeGateway: () => ({
    onEvent(handler: typeof emit) {
      emit = handler

      return () => {
        emit = () => {}
      }
    },
    async request(method: string) {
      if (method === 'session.create') {
        if (releaseSession) {
          await new Promise<void>(resolve => {
            const previous = releaseSession

            releaseSession = () => {
              previous?.()
              resolve()
            }
          })
        }

        return { session_id: 'session-1' }
      }

      if (method === 'session.interrupt') {
        interrupted += 1

        return {}
      }

      if (method === 'prompt.submit') {
        submitted += 1

        // What the real gateway returns: the turn has STARTED. Nothing about
        // it says the model has said anything yet.
        return { status: 'streaming', turn_isolation: true }
      }

      return {}
    }
  })
}))

const { $inlineAi, runInlineAi } = await import('./inline-ai-store')

/** A stand-in for the CodeMirror view, backed by a real EditorState. */
function fakeView(text: string) {
  let state = EditorState.create({ doc: text })

  return {
    get state() {
      return state
    },
    dispatch(spec: { changes: unknown }) {
      state = state.update({ changes: spec.changes as never }).state
    },
    dom: { addEventListener() {}, removeEventListener() {} },
    focus() {},
    text: () => state.doc.toString()
  }
}

/** Let queued promise callbacks run without advancing the clock. */
const settle = async () => {
  for (let i = 0; i < 12; i += 1) {
    await Promise.resolve()
  }
}

function selectAll(view: ReturnType<typeof fakeView>, selected: string) {
  $editorView.set(view)
  $inlineAi.set({
    status: 'prompt',
    top: 0,
    left: 0,
    anchor: 0,
    range: { from: 0, to: selected.length },
    selected,
    sessionId: null,
    error: null
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  submitted = 0
  interrupted = 0
  releaseSession = null
  $activeNote.set({ path: 'Note.md' })
})

afterEach(() => {
  vi.useRealTimers()
  $inlineAi.set({
    status: 'idle',
    top: 0,
    left: 0,
    anchor: 0,
    range: null,
    selected: '',
    sessionId: null,
    error: null
  })
})

test('a reply that arrives after a slow think still reaches the document', async () => {
  const view = fakeView('The quick brown fox jumps over the lazy dog.')
  selectAll(view, view.text())

  const run = runInlineAi('Rewrite it significantly shorter, keeping every fact.')

  await settle()
  assert.equal(submitted, 1, 'the prompt was submitted')

  // openai-codex thinks for six seconds and then sends the whole answer in one
  // frame. Anything that gave up before this point produced nothing at all.
  await vi.advanceTimersByTimeAsync(6_000)
  emit({ session_id: 'session-1', type: 'message.complete', payload: { text: 'A fox jumped the dog.' } })

  await run
  await settle()

  assert.equal(view.text(), 'A fox jumped the dog.')
})

test('a long stream is not cut off partway through', async () => {
  const view = fakeView('one')
  selectAll(view, 'one')

  const run = runInlineAi('expand this')

  await settle()

  // Nine seconds of steady output — far past any short deadline.
  for (const word of ['alpha ', 'beta ', 'gamma ', 'delta ', 'epsilon ', 'zeta ']) {
    await vi.advanceTimersByTimeAsync(1_500)
    emit({ session_id: 'session-1', type: 'message.delta', payload: { text: word } })
    await settle()
  }

  emit({ session_id: 'session-1', type: 'message.complete', payload: {} })

  await run
  await settle()

  assert.equal(view.text(), 'alpha beta gamma delta epsilon zeta ', 'every delta survived')
})

test('a turn that never answers gives up instead of hanging forever', async () => {
  const view = fakeView('untouched')
  selectAll(view, 'untouched')

  const run = runInlineAi('do something')

  await settle()

  // The gateway accepted the turn and then went silent — a dropped connection,
  // a wedged provider. The overlay must not spin for the rest of the session.
  await vi.advanceTimersByTimeAsync(10 * 60_000)
  await run
  await settle()

  assert.equal($inlineAi.get().error, 'The assistant stopped responding.', 'and says so rather than just closing')
  assert.equal(view.text(), 'untouched', 'having written nothing it never received')
})


test('a note opened while the session is still being created gets nothing written into it', async () => {
  /*
   * session.create is allowed thirty seconds, and the run was only registered
   * after it returned. For that whole window the note-switch guard and the
   * destroyed-view guard both read `activeRun === null` and stopped nothing.
   *
   * So the deltas landed in whichever document was open by then, at the offsets
   * measured in the old one — and in rewrite mode the first delta deleted that
   * span of the new note and replaced it with the other note's answer. Autosave
   * committed it within the second. The undo bar is keyed to the note the run
   * started in, so it declined to act while still reporting "Undone".
   */
  const noteA = fakeView('The quick brown fox jumps over the lazy dog.')

  releaseSession = () => {}
  selectAll(noteA, noteA.text())

  const run = runInlineAi('Rewrite it significantly shorter.')

  await settle()
  assert.equal(submitted, 0, 'the session is still being created')

  // The user gives up waiting and opens another note.
  const noteB = fakeView('# Note B\n\nEverything I wrote here yesterday.')

  $editorView.set(noteB)
  $activeNote.set({ path: 'B.md' })

  releaseSession?.()
  await settle()
  await vi.advanceTimersByTimeAsync(1_000)

  // Whatever the session would have said, it must not be said here.
  emit({ session_id: 'session-1', type: 'message.delta', payload: { text: 'A fox jumped the dog.' } })
  emit({ session_id: 'session-1', type: 'message.complete', payload: { text: 'A fox jumped the dog.' } })
  await settle()

  assert.equal(noteB.text(), '# Note B\n\nEverything I wrote here yesterday.', 'note B was written into')
  assert.equal(submitted, 0, 'the abandoned run still asked the model to answer')
  assert.equal(interrupted, 1, 'the orphaned session was not cancelled')

  await run
})

test('the prompt panel never hangs off the edge of the editor', async () => {
  /*
   * `left` is measured against the editor's own box, and there was a lower
   * clamp but no upper one. Asking about anything in the right-hand half of a
   * line pushed the prompt — and the action list under it — past the pane,
   * where it could not be read or clicked. Reproduced in the real app at a
   * 1280px window before this.
   */
  const { panelLeft } = await import('./inline-ai-store')

  const host = 700
  const panel = Math.min(416, host * 0.85)

  // Anchored to the selection when there is room.
  assert.equal(panelLeft(40, host), 40)

  // Slid left when there is not — and still fully inside.
  assert.ok(panelLeft(650, host) + panel <= host, `${panelLeft(650, host)} + ${panel} > ${host}`)

  // Never off the left edge either.
  assert.ok(panelLeft(-50, host) >= 0)

  // A pane narrower than the panel still yields a usable position.
  assert.ok(panelLeft(300, 320) >= 0)

  // An unmeasured host (detached view) must not produce NaN.
  assert.equal(Number.isFinite(panelLeft(100, 0)), true)
})
