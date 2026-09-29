import { describe, expect, it, vi } from 'vitest'

import { WindowCloseGuard } from './window-close-guard'

describe('editor close acknowledgement', () => {
  it('waits for the correct editor and request, coalescing repeated closes', async () => {
    let challenge = ''
    const guard = new WindowCloseGuard((_window, id) => { challenge = id })
    const done = vi.fn()
    const pending = guard.request(1)
    expect(guard.request(1)).toBe(pending)
    void pending.then(done)
    guard.respond(2, challenge, true)
    guard.respond(1, 'stale challenge', true)
    await Promise.resolve()
    expect(done).not.toHaveBeenCalled()
    guard.respond(1, challenge, true)
    await pending
    expect(done).toHaveBeenCalledOnce()
  })
  it('rejects failed persistence and permits another attempt', async () => {
    let challenge = ''
    const guard = new WindowCloseGuard((_window, id) => { challenge = id })
    const pending = guard.request(1)
    guard.respond(1, challenge, false, 'disk full')
    await expect(pending).rejects.toThrow('disk full')
    const retry = guard.request(1)
    guard.respond(1, challenge, true)
    await expect(retry).resolves.toBeUndefined()
  })
})
