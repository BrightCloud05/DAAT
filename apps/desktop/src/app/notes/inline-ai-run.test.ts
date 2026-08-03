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
        return { session_id: 'session-1' }
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
