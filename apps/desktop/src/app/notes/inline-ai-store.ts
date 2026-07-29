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
  sessionId: string | null
  error: string | null
}

const IDLE: InlineAiState = { status: 'idle', top: 0, left: 0, anchor: 0, sessionId: null, error: null }

export const $inlineAi = atom<InlineAiState>(IDLE)

export function openInlineAiAt(anchor: number): void {
  const view = $editorView.get()

  if (!view) {
    return
  }

  const coords = view.coordsAtPos(anchor)
  const host = view.dom.getBoundingClientRect()

  $inlineAi.set({
    status: 'prompt',
    top: (coords?.bottom ?? host.top) - host.top + 4,
    left: Math.max(8, (coords?.left ?? host.left) - host.left),
    anchor,
    sessionId: null,
    error: null
  })
}

export function closeInlineAi(): void {
  const state = $inlineAi.get()

  if (state.status === 'running' && state.sessionId) {
    void cancelRun(state.sessionId)
  }

  $inlineAi.set(IDLE)
  $editorView.get()?.focus()
}

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
  const anchor = $inlineAi.get().anchor
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

  let anchor = state.anchor
  let finished = false

  $inlineAi.set({ ...state, status: 'running', sessionId, error: null })

  const finish = async (deleteSession: boolean) => {
    if (finished) {
      return
    }

    finished = true
    unsubscribe()
    unsubscribeEdits()

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

  const unsubscribe = gateway.onEvent(event => {
    if (event.session_id !== sessionId) {
      return
    }

    if (event.type === 'message.delta') {
      const payload = event.payload as { text?: unknown } | undefined
      const text = typeof payload?.text === 'string' ? payload.text : ''

      if (text) {
        view.dispatch({
          changes: { from: anchor, insert: text },
          annotations: inlineAiInsert.of(true),
          scrollIntoView: true
        })
        anchor += text.length
      }
    }

    if (event.type === 'message.complete') {
      void finish(true)
    }

    if (event.type === 'error') {
      void finish(false)
    }
  })

  // A user edit during generation would corrupt the anchor — cancel instead.
  const unsubscribeEdits = (() => {
    const listener = view.dom.addEventListener.bind(view.dom)
    const onInput = () => {
      if (!finished) {
        void cancelRun(sessionId!)
        void finish(false)
      }
    }

    listener('keydown', onInput)

    return () => view.dom.removeEventListener('keydown', onInput)
  })()

  try {
    await gateway.request('prompt.submit', { session_id: sessionId, text: buildPrompt(task) }, PROMPT_SUBMIT_REQUEST_TIMEOUT_MS)
    void finish(true)
  } catch (error) {
    void finish(false)

    const current = $inlineAi.get()

    if (current.status !== 'idle') {
      $inlineAi.set({ ...current, status: 'prompt', error: error instanceof Error ? error.message : 'Generation failed.' })
    }
  }
}
