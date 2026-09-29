import assert from 'node:assert/strict'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, test, vi } from 'vitest'
vi.mock('../vault/store', async () => ({ $vaultRevision: (await import('nanostores')).atom(0) }))
import { createQuickEvent, moveEntryToDate, QuickAddRow } from './quick-event'
import { $productLocale, productStrings } from './strings'
let content: string
let saved: ReturnType<typeof vi.fn>
beforeEach(() => {
  $productLocale.set('en')
  content = '- [ ] Beta 📅 2026-09-15\n- [ ] Alpha 📅 2026-09-15\n'
  saved = vi.fn(async (_path: string, next: string) => {
    content = next

    return { ok: true }
  })
  window.hermesDesktop = {
    vault: {
      info: async () => ({ root: '/vault-a' }),
      read: async () => ({ content, mtimeMs: 1, vaultRoot: '/vault-a' }),
      createNote: vi.fn(async () => ({ created: true, content: '', mtimeMs: 1 })),
      write: saved
    }
  } as unknown as typeof window.hermesDesktop
})
afterEach(cleanup)
const entry = { kind: 'task' as const, path: 'Tasks.md', line: 1, date: '2026-09-15', label: 'Alpha' }
test('moving a stale row follows only the unique original task and refuses ambiguous duplicates', async () => {
  assert.equal(await moveEntryToDate(entry, '2026-09-16'), true)
  assert.equal(content, '- [ ] Beta 📅 2026-09-15\n- [ ] Alpha 📅 2026-09-16\n')
  assert.equal(saved.mock.calls[0][4], '/vault-a')
  content = '- [ ] Alpha 📅 2026-09-15\n- [ ] Alpha 📅 2026-09-15\n'
  saved.mockClear()
  assert.equal(await moveEntryToDate(entry, '2026-09-16'), false)
  assert.equal(saved.mock.calls.length, 0)
})
test('rejected writes stay visible and keep the typed event; composing Enter never submits', async () => {
  saved.mockResolvedValue({ ok: false, reason: 'unreadable' })
  await assert.rejects(createQuickEvent('Meeting', '2026-09-15'))
  saved.mockClear()
  render(<QuickAddRow date="2026-09-15" />)
  const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value: '회의' } })
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  assert.equal(saved.mock.calls.length, 0)
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() =>
    assert.ok(screen.getByRole('alert').textContent?.includes(productStrings('en').calendarSaveFailed))
  )
  assert.equal((input as HTMLInputElement).value, '회의')
})
