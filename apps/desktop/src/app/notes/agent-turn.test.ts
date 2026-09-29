/**
 * The contract every caller kept getting wrong: prompt.submit returning means
 * the turn STARTED. These pin the waiting down so the next feature that talks
 * to the gateway inherits it instead of rediscovering it.
 */

import assert from 'node:assert/strict'

import { afterEach, beforeEach, test, vi } from 'vitest'

vi.mock('@/hermes', () => ({ PROMPT_SUBMIT_REQUEST_TIMEOUT_MS: 1_800_000 }))

const { submitAndAwaitTurn, TURN_SILENCE_TIMEOUT_MS } = await import('./agent-turn')

/** A gateway that answers submit immediately and speaks only when told to. */
function fakeGateway(options: { onSubmit?: (emit: Emit) => void } = {}) {
  let handler: Emit = () => {}
  let listening = false

  return {
    emit(event: Parameters<Emit>[0]) {
      handler(event)
    },
    get listening() {
      return listening
    },
    onEvent(next: Emit) {
      handler = next
      listening = true

      return () => {
        listening = false

        handler = () => {}
      }
    },
    async request(method: string) {
      if (method === 'prompt.submit') {
        options.onSubmit?.(event => handler(event))

        return { status: 'streaming' }
      }

      return {}
    }
  }
}

type Emit = (event: { session_id?: string; type?: string; payload?: unknown }) => void

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

test('does not resolve on submit — only when the turn completes', async () => {
  const gateway = fakeGateway()
  let settled = false

  const turn = submitAndAwaitTurn(gateway, 's1', 'do the thing').then(result => {
    settled = true

    return result
  })

  await vi.advanceTimersByTimeAsync(30_000)
  assert.equal(settled, false, '30 seconds of thinking is not a finished turn')

  gateway.emit({ session_id: 's1', type: 'message.complete', payload: { text: 'done' } })

  assert.deepEqual(await turn, { text: 'done', error: null })
})

test('a turn that finishes before the submit call returns is not missed', async () => {
  // Subscribing after awaiting submit would lose this frame entirely.
  const gateway = fakeGateway({
    onSubmit: emit => emit({ session_id: 's1', type: 'message.complete', payload: { text: 'instant' } })
  })

  assert.deepEqual(await submitAndAwaitTurn(gateway, 's1', 'x'), { text: 'instant', error: null })
})

test('another session talking does not end this turn', async () => {
  const gateway = fakeGateway()
  let settled = false

  const turn = submitAndAwaitTurn(gateway, 's1', 'x').then(r => {
    settled = true

    return r
  })

  await vi.advanceTimersByTimeAsync(10)
  gateway.emit({ session_id: 'someone-else', type: 'message.complete', payload: { text: 'not mine' } })
  await vi.advanceTimersByTimeAsync(10)

  assert.equal(settled, false)

  gateway.emit({ session_id: 's1', type: 'message.complete', payload: { text: 'mine' } })
  assert.equal((await turn).text, 'mine')
})

test('an error frame is reported, not swallowed', async () => {
  const gateway = fakeGateway()
  const turn = submitAndAwaitTurn(gateway, 's1', 'x')

  await vi.advanceTimersByTimeAsync(10)
  gateway.emit({ session_id: 's1', type: 'error', payload: { message: 'no credits left' } })

  assert.equal((await turn).error, 'no credits left')
})

test('silence eventually ends the wait, and unsubscribes', async () => {
  const gateway = fakeGateway()
  const turn = submitAndAwaitTurn(gateway, 's1', 'x')

  await vi.advanceTimersByTimeAsync(TURN_SILENCE_TIMEOUT_MS + 1_000)

  assert.ok((await turn).error, 'a turn that never answers must not wait forever')
  assert.equal(gateway.listening, false, 'and must not leave a listener behind')
})

test('each frame pushes the watchdog back', async () => {
  const gateway = fakeGateway()
  let settled = false

  const turn = submitAndAwaitTurn(gateway, 's1', 'x').then(r => {
    settled = true

    return r
  })

  // Tool calls for twice the silence budget: busy is not silent.
  for (let i = 0; i < 4; i += 1) {
    await vi.advanceTimersByTimeAsync(TURN_SILENCE_TIMEOUT_MS / 2)
    gateway.emit({ session_id: 's1', type: 'tool.start', payload: { name: 'vault_write' } })
  }

  assert.equal(settled, false, 'a working agent is not a stalled one')

  gateway.emit({ session_id: 's1', type: 'message.complete', payload: { text: 'ok' } })
  assert.equal((await turn).error, null)
})
