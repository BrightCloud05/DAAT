/**
 * Waiting for an agent turn to actually finish.
 *
 * `prompt.submit` returns when the turn STARTS. The gateway answers
 * `{"status": "streaming"}` the moment it hands the text to the agent
 * (tui_gateway/server.py:1500) and the real answer arrives later, as
 * `message.delta` frames and a closing `message.complete`. src/hermes.ts says
 * so in as many words, right above the timeout constant everyone imports.
 *
 * Reading that return as "the turn is done" has now broken two features in two
 * different ways:
 *
 *   · inline AI armed a 1.5s teardown after it, so Rewrite and Make shorter
 *     wrote nothing at all on a provider that answers in one late frame;
 *   · the setup wizard listed the notes the agent had "created" immediately
 *     after submitting, always found none, and advanced to the next question
 *     while the turn was still running — where the second submit hit the
 *     gateway's 4009 "session busy" guard and surfaced as "the assistant
 *     stopped responding".
 *
 * So the waiting lives here once, and callers stop having to know.
 */

import { PROMPT_SUBMIT_REQUEST_TIMEOUT_MS } from '@/hermes'

/**
 * How long a started turn may stay silent before we give up on it.
 *
 * A watchdog for a turn that will never answer — a dropped socket, a wedged
 * provider — and nothing else. Deliberately far longer than a slow model: a
 * reasoning model can think for a minute before its first token, and
 * openai-codex emits nothing at all until one frame at the very end. Every
 * frame that arrives pushes it back, so it can only fire on real silence.
 */
export const TURN_SILENCE_TIMEOUT_MS = 5 * 60_000

interface GatewayLike {
  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown>
  onEvent(handler: (event: { session_id?: string; type?: string; payload?: unknown }) => void): () => void
}

export interface TurnResult {
  /** The assistant's final text, when the backend sent one. */
  text: string
  /** Set when the turn ended badly, or timed out in silence. */
  error: string | null
}

/**
 * Submit a prompt and resolve once the turn is over.
 *
 * Subscribes before submitting, because a fast turn can complete before an
 * `await` on the submit call has yielded — subscribing afterwards would miss
 * the very frame being waited for.
 */
export async function submitAndAwaitTurn(
  gateway: GatewayLike,
  sessionId: string,
  text: string,
  options: {
    onEvent?: (event: { type?: string; payload?: unknown }) => void
    silenceMs?: number
  } = {}
): Promise<TurnResult> {
  const silenceMs = options.silenceMs ?? TURN_SILENCE_TIMEOUT_MS

  return new Promise<TurnResult>(resolve => {
    let done = false
    let timer: ReturnType<typeof setTimeout> | null = null

    let unsubscribe = () => {}

    const settle = (result: TurnResult) => {
      if (done) {
        return
      }

      done = true

      if (timer) {
        clearTimeout(timer)
      }

      unsubscribe()
      resolve(result)
    }

    const keepWaiting = () => {
      if (done) {
        return
      }

      if (timer) {
        clearTimeout(timer)
      }

      timer = setTimeout(() => settle({ text: '', error: 'The assistant stopped responding.' }), silenceMs)
    }

    unsubscribe = gateway.onEvent(event => {
      if (event.session_id !== sessionId) {
        return
      }

      keepWaiting()
      options.onEvent?.(event)

      if (event.type === 'message.complete') {
        const payload = event.payload as { text?: unknown; error?: unknown } | undefined

        settle({
          text: typeof payload?.text === 'string' ? payload.text : '',
          error: typeof payload?.error === 'string' && payload.error ? payload.error : null
        })
      }

      if (event.type === 'error') {
        const payload = event.payload as { message?: unknown } | undefined

        settle({
          text: '',
          error: typeof payload?.message === 'string' ? payload.message : 'Generation failed.'
        })
      }
    })

    keepWaiting()

    void gateway
      .request('prompt.submit', { session_id: sessionId, text }, PROMPT_SUBMIT_REQUEST_TIMEOUT_MS)
      .catch((error: unknown) => {
        settle({ text: '', error: error instanceof Error ? error.message : 'Could not reach the assistant.' })
      })
  })
}
