/**
 * Inline AI: Notion's space-bar writing assistant, powered by the real
 * gateway. A throwaway session streams message.delta text straight into the
 * document at the anchor; the transcript session is deleted on success so
 * chat history stays clean. Any user edit during generation cancels the run
 * (position safety beats cleverness).
 */

import { Annotation } from '@codemirror/state'
import { atom } from 'nanostores'

import { PROMPT_SUBMIT_REQUEST_TIMEOUT_MS } from '@/hermes'
import { activeGateway } from '@/store/gateway'

import { $editorView } from '../vault/editor-bridge'
import { $activeNote, $vaultInfo, flushActiveNote } from '../vault/store'

export const inlineAiInsert = Annotation.define<boolean>()

export interface InlineAiState {
  status: 'idle' | 'prompt' | 'running'
  /** Editor-host-relative coords for the overlay. */
  top: number
  left: number
  /** Doc position where output streams in. */
  anchor: number
  /**
   * The passage being rewritten, when the user had text selected. Null means
   * "write something new here" — the two modes need different prompts and
   * different edits, so the overlay reads this to say which one it is.
   */
  range: { from: number; to: number } | null
  /** The selected text, captured at open time so the prompt can quote it. */
  selected: string
  sessionId: string | null
  error: string | null
}

const IDLE: InlineAiState = {
  status: 'idle',
  top: 0,
  left: 0,
  anchor: 0,
  range: null,
  selected: '',
  sessionId: null,
  error: null
}

export const $inlineAi = atom<InlineAiState>(IDLE)

/**
 * The "⌘I to edit" nudge that follows a selection.
 *
 * The inline assistant was finished and working for weeks and nobody could
 * find it, because nothing on screen said it was there. A keyboard shortcut
 * with no affordance is a feature only its author has.
 */
export interface AiHintState {
  visible: boolean
  top: number
  left: number
  from: number
  to: number
}

export const $aiHint = atom<AiHintState>({ visible: false, top: 0, left: 0, from: 0, to: 0 })

export function setAiHint(next: AiHintState): void {
  const current = $aiHint.get()

  if (
    current.visible === next.visible &&
    current.from === next.from &&
    current.to === next.to &&
    Math.round(current.top) === Math.round(next.top) &&
    Math.round(current.left) === Math.round(next.left)
  ) {
    return
  }

  $aiHint.set(next)
}

export function hideAiHint(): void {
  if ($aiHint.get().visible) {
    $aiHint.set({ ...$aiHint.get(), visible: false })
  }
}

/**
 * What the last generation replaced, so it can be put back.
 *
 * A rewrite destroys the user's own words, and CodeMirror's history can't
 * undo it in one step because the output arrives as many separate dispatches.
 * "The AI mangled my paragraph and I can't get it back" is the fastest way to
 * lose someone's trust in a feature like this, so the previous text is kept
 * until they move on.
 */
export interface AiUndoState {
  from: number
  to: number
  /** The text that was there before. Empty when the run only inserted. */
  restore: string
  notePath: string | null
}

export const $aiUndo = atom<AiUndoState | null>(null)

export function undoInlineAi(): void {
  const undo = $aiUndo.get()
  const view = $editorView.get()

  $aiUndo.set(null)

  if (!undo || !view || undo.notePath !== $activeNote.get()?.path) {
    return
  }

  const end = Math.min(undo.to, view.state.doc.length)

  if (undo.from > end) {
    return
  }

  view.dispatch({
    changes: { from: undo.from, to: end, insert: undo.restore },
    selection: { anchor: undo.from + undo.restore.length },
    annotations: inlineAiInsert.of(true)
  })
  view.focus()
  void flushActiveNote()
}

/**
 * Teardown for the run in flight. It lives at module scope because the things
 * that must stop a run — the Stop button, Escape, switching notes, unmounting
 * the pane — all happen outside `runInlineAi`'s closure. Without it, "Stop"
 * only hid the overlay while deltas kept writing into the document.
 */
let activeRun: { notePath: string | null; stop: () => void } | null = null

export function openInlineAiAt(anchor: number, range?: { from: number; to: number }): void {
  const view = $editorView.get()

  if (!view) {
    return
  }

  const selected = range ? view.state.doc.sliceString(range.from, range.to) : ''

  // Re-triggering while a generation is streaming used to leave that run
  // writing into the document with no overlay and no way to stop it: the
  // keypress is preventDefault'ed, so the edit-cancellation path never fired.
  if (activeRun) {
    closeInlineAi()
  }

  // coordsAtPos can throw when the position isn't laid out (a detached or
  // freshly-mounted view). It is only used to place the bubble, so a throw
  // here must not take the keypress — and the fallback below already handles
  // a missing measurement.
  let coords: { bottom: number; left: number } | null = null

  try {
    coords = view.coordsAtPos(anchor)
  } catch {
    coords = null
  }

  const host = view.dom.getBoundingClientRect()

  $inlineAi.set({
    status: 'prompt',
    top: (coords?.bottom ?? host.top) - host.top + 4,
    left: Math.max(8, (coords?.left ?? host.left) - host.left),
    anchor,
    range: range ?? null,
    selected,
    sessionId: null,
    error: null
  })
}

export function closeInlineAi(): void {
  const state = $inlineAi.get()

  if (state.status === 'running' && state.sessionId) {
    void cancelRun(state.sessionId)
  }

  activeRun?.stop()
  $inlineAi.set(IDLE)
  $editorView.get()?.focus()
}

/**
 * Switching notes mid-generation used to keep streaming into the same
 * EditorView — whose document is now a different file — at the old offset,
 * and then persist the damage. Stop the run instead.
 */
$activeNote.subscribe(note => {
  if (activeRun && note?.path !== activeRun.notePath) {
    closeInlineAi()
  }

  const undo = $aiUndo.get()

  // Offsets only mean anything inside the document they were measured in.
  if (undo && undo.notePath !== (note?.path ?? null)) {
    $aiUndo.set(null)
  }
})

/**
 * The editor pane unmounts when the canvas switches to Home/Todo/Calendar/…,
 * destroying the view. Deltas then dispatch into a destroyed view, which
 * CodeMirror silently ignores — so the whole generation was thrown away while
 * the overlay still claimed to be running.
 */
$editorView.subscribe(view => {
  if (activeRun && !view) {
    closeInlineAi()
  }
})

async function cancelRun(sessionId: string): Promise<void> {
  try {
    await activeGateway()?.request('session.interrupt', { session_id: sessionId }, 10_000)
  } catch {
    // Session may already be done.
  }
}

function buildPrompt(task: string): string {
  const note = $activeNote.get()
  const view = $editorView.get()
  const title = note?.path.split('/').pop()?.replace(/\.(md|markdown)$/i, '') ?? 'Untitled'
  const doc = view?.state.doc.toString() ?? ''
  const { anchor, range, selected } = $inlineAi.get()

  // Rewriting a selection is a different job from writing at a cursor, and
  // the cursor prompt is actively wrong for it: "do not repeat the existing
  // text" is precisely what a rewrite must do.
  if (range) {
    const before = doc.slice(Math.max(0, range.from - 2000), range.from)
    const after = doc.slice(range.to, range.to + 1000)

    return [
      `You are editing a passage INSIDE the user's markdown note titled "${title}".\n\n`,
      before ? `Text before it (context only, do not rewrite):\n"""\n${before}\n"""\n\n` : '',
      `THE PASSAGE TO REWRITE:\n"""\n${selected}\n"""\n\n`,
      after ? `Text after it (context only, do not rewrite):\n"""\n${after}\n"""\n\n` : '',
      `Instruction: ${task}\n\n`,
      'Reply with ONLY the rewritten passage, which will replace it exactly as you write it. ',
      'Keep the markdown formatting and heading levels it already uses unless the instruction ',
      'says otherwise. No preamble, no explanation, no wrapping code fence.'
    ].join('')
  }

  // Window the context around the cursor so huge notes stay cheap.
  const before = doc.slice(Math.max(0, anchor - 4000), anchor)
  const after = doc.slice(anchor, anchor + 1000)

  return [
    `You are writing INSIDE the user's markdown note titled "${title}". `,
    'Text before the cursor:\n"""\n',
    before,
    '\n"""\n',
    after ? `Text after the cursor:\n"""\n${after}\n"""\n` : '',
    `Task: ${task}\n`,
    'Reply with ONLY the markdown text to insert at the cursor position. ',
    'No preamble, no explanations, no wrapping code fence. Do not repeat the existing text.'
  ].join('')
}

export async function runInlineAi(task: string): Promise<void> {
  const view = $editorView.get()
  const gateway = activeGateway()
  const state = $inlineAi.get()

  if (!view || state.status !== 'prompt') {
    return
  }

  if (!gateway) {
    $inlineAi.set({ ...state, error: 'Agent is not connected yet.' })

    return
  }

  const note = $activeNote.get()
  const title = `AI · ${note?.path.split('/').pop()?.replace(/\.(md|markdown)$/i, '') ?? 'note'}`

  let sessionId: string | null = null

  try {
    const created = (await gateway.request(
      'session.create',
      { title, cwd: $vaultInfo.get()?.root ?? undefined },
      30_000
    )) as Record<string, unknown> | null

    sessionId = String(created?.session_id ?? created?.sid ?? created?.id ?? '') || null
  } catch (error) {
    $inlineAi.set({ ...state, error: error instanceof Error ? error.message : 'Could not start the agent.' })

    return
  }

  if (!sessionId) {
    $inlineAi.set({ ...state, error: 'The agent did not return a session.' })

    return
  }

  // A rewrite starts by consuming the selection: the first chunk of output
  // replaces it, and everything after that appends normally.
  const origin = state.range ? state.range.from : state.anchor
  const replaced = state.selected
  let anchor = origin
  let pending = state.range ? { from: state.range.from, to: state.range.to } : null
  let streamed = 0
  let finished = false
  let graceTimer: ReturnType<typeof setTimeout> | null = null
  const notePath = note?.path ?? null

  $aiUndo.set(null)
  $inlineAi.set({ ...state, status: 'running', sessionId, error: null })

  const finish = async (deleteSession: boolean) => {
    if (finished) {
      return
    }

    finished = true

    if (graceTimer) {
      clearTimeout(graceTimer)
      graceTimer = null
    }

    if (activeRun?.notePath === notePath) {
      activeRun = null
    }

    unsubscribe()
    unsubscribeEdits()

    // Offer the way back, but only if something was actually written — a run
    // the user stopped before the first token has nothing to undo.
    if (streamed > 0) {
      $aiUndo.set({ from: origin, to: origin + streamed, restore: replaced, notePath })
    }

    if (deleteSession && sessionId) {
      try {
        await gateway.request('session.delete', { session_id: sessionId }, 10_000)
      } catch {
        // Leaving the transcript behind is harmless.
      }
    }

    if ($inlineAi.get().sessionId === sessionId) {
      $inlineAi.set(IDLE)
    }

    await flushActiveNote()
  }

  /** One insertion point for both paths, so the two can't drift apart. */
  const write = (text: string) => {
    view.dispatch({
      changes: pending ? { from: pending.from, to: pending.to, insert: text } : { from: anchor, insert: text },
      annotations: inlineAiInsert.of(true),
      scrollIntoView: true
    })
    anchor = (pending ? pending.from : anchor) + text.length
    pending = null
    streamed += text.length
  }

  const unsubscribe = gateway.onEvent(event => {
    if (event.session_id !== sessionId) {
      return
    }

    if (event.type === 'message.delta') {
      const payload = event.payload as { text?: unknown } | undefined
      const text = typeof payload?.text === 'string' ? payload.text : ''

      if (text) {
        write(text)
      }
    }

    if (event.type === 'message.complete') {
      // Not every backend streams. The Codex provider sends no deltas at all
      // and only this one event, so without writing its text here the whole
      // feature silently produced nothing on that backend.
      const payload = event.payload as { text?: unknown } | undefined
      const whole = typeof payload?.text === 'string' ? payload.text : ''

      if (whole && whole.length > streamed) {
        write(streamed ? whole.slice(streamed) : whole)
      }

      void finish(true)
    }

    if (event.type === 'error') {
      void finish(false)
    }
  })

  // A user edit during generation would corrupt the anchor — cancel instead.
  // `beforeinput` is the event that actually means "the document is about to
  // change": it covers typing, paste, drop, cut and IME commits alike, where
  // keydown both missed paste and fired on harmless arrow keys.
  const unsubscribeEdits = (() => {
    const onEdit = () => {
      if (!finished) {
        void cancelRun(sessionId!)
        void finish(false)
      }
    }

    const events = ['beforeinput', 'paste', 'drop', 'cut'] as const

    for (const name of events) {
      view.dom.addEventListener(name, onEdit)
    }

    return () => {
      for (const name of events) {
        view.dom.removeEventListener(name, onEdit)
      }
    }
  })()

  activeRun = {
    notePath,
    stop: () => {
      void finish(false)
    }
  }

  try {
    await gateway.request('prompt.submit', { session_id: sessionId, text: buildPrompt(task) }, PROMPT_SUBMIT_REQUEST_TIMEOUT_MS)

    // The request resolving does not guarantee the last delta has arrived, so
    // let message.complete terminate normally and only force the issue if it
    // never comes — tearing down immediately truncated the output.
    if (!finished) {
      graceTimer = setTimeout(() => void finish(true), 1500)
    }
  } catch (error) {
    // Read the message before finish() resets the store, or the user is shown
    // nothing at all.
    const message = error instanceof Error ? error.message : 'Generation failed.'

    await finish(false)
    $inlineAi.set({
      ...$inlineAi.get(),
      status: 'prompt',
      anchor: state.anchor,
      range: state.range,
      selected: state.selected,
      top: state.top,
      left: state.left,
      error: message
    })
  }
}
