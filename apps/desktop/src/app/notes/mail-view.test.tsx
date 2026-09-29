import assert from 'node:assert/strict'

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, test, vi } from 'vitest'

import { MailView } from './mail-view'
import { $productLocale } from './strings'

const row = (subject: string) => ({
  id: '42',
  subject,
  fromName: subject,
  fromAddr: 'test@example.invalid',
  date: '2026-09-15',
  seen: false
})

function deferred<T>() {
  let resolve!: (value: T) => void

  const promise = new Promise<T>(done => {
    resolve = done
  })

  return { promise, resolve }
}

let bridge: {
  status: ReturnType<typeof vi.fn>
  list: ReturnType<typeof vi.fn>
  search: ReturnType<typeof vi.fn>
  read: ReturnType<typeof vi.fn>
  move: ReturnType<typeof vi.fn>
  flag: ReturnType<typeof vi.fn>
  folders: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  $productLocale.set('en')
  bridge = {
    status: vi.fn(async () => ({
      installed: true,
      accounts: [
        { name: 'A', default: true },
        { name: 'B', default: false }
      ]
    })),
    list: vi.fn(async ({ account }) => [row(`${account} inbox`)]),
    search: vi.fn(async () => []),
    read: vi.fn(async () => 'Message body'),
    move: vi.fn(async () => undefined),
    flag: vi.fn(async () => undefined),
    folders: vi.fn(async () => ['Archive', 'Trash'])
  }
  window.hermesDesktop = { mail: bridge } as unknown as typeof window.hermesDesktop
})
afterEach(cleanup)
test('a stale search cannot replace a new account; actions and assistant prompts include account identity', async () => {
  const oldSearch = deferred<ReturnType<typeof row>[]>()
  bridge.search.mockReturnValueOnce(oldSearch.promise)
  const ask = vi.fn()
  render(<MailView onAskAgent={ask} />)
  await screen.findByRole('button', { name: /A inbox/ })
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'old query' } })
  fireEvent.submit(screen.getByRole('textbox').closest('form')!)
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'B' } })
  const b = await screen.findByRole('button', { name: /B inbox/ })
  await act(async () => oldSearch.resolve([row('Stale A search')]))
  assert.equal(screen.queryByText('Stale A search'), null)
  fireEvent.click(b)
  await screen.findByText('Message body')
  fireEvent.click(screen.getByRole('button', { name: /Summarize/ }))
  assert.match(ask.mock.calls[0][0], /account "B"/)
  fireEvent.click(screen.getByRole('button', { name: /^Archive$/ }))
  await waitFor(() => assert.equal(bridge.move.mock.calls.length, 1))
  assert.deepEqual(bridge.move.mock.calls[0][0], { id: '42', account: 'B', folder: 'INBOX', target: 'archive' })
})
test('read failure remains an error with a retry, and a failed move restores the message', async () => {
  bridge.read.mockRejectedValueOnce(new Error('offline'))
  bridge.move.mockRejectedValueOnce(new Error('timeout'))
  render(<MailView />)
  fireEvent.click(await screen.findByRole('button', { name: /A inbox/ }))
  const alert = await screen.findByRole('alert')
  assert.match(alert.textContent ?? '', /offline/)
  fireEvent.click(screen.getByRole('button', { name: /Retry/ }))
  await screen.findByText('Message body')
  fireEvent.click(screen.getByRole('button', { name: /^Archive$/ }))
  await waitFor(() => assert.match(screen.getByRole('alert').textContent ?? '', /timeout/))
  assert.ok(screen.getByRole('button', { name: /A inbox/ }))
  assert.equal(bridge.move.mock.calls.length, 1)
})
