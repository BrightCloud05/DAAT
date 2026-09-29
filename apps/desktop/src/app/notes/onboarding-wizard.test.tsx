import assert from 'node:assert/strict'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, test, vi } from 'vitest'
const controls = vi.hoisted(() => ({ apply: vi.fn(), finish: vi.fn(), end: vi.fn() }))
vi.mock('./persona-store', () => ({ applyPersona: controls.apply, finishOnboarding: controls.finish }))
vi.mock('./setup-agent', () => ({ endSetup: controls.end }))
vi.mock('./setup-chat', () => ({ SetupChat: () => <p>Setup conversation</p> }))
vi.mock('../vault/store', async () => ({
  $vaultInfo: (await import('nanostores')).atom({ root: '/test/notes', location: 'local' }),
  chooseVault: vi.fn()
}))
import { OnboardingWizard } from './onboarding-wizard'
import { PERSONAS } from './personas'
import { $productLocale } from './strings'
beforeEach(() => {
  $productLocale.set('en')
  controls.apply.mockReset()
  controls.finish.mockReset()
  controls.end.mockReset().mockResolvedValue(undefined)
})
afterEach(cleanup)
test('double-clicking a persona still visits folder selection, and partial failure stays reviewable before continuing', async () => {
  controls.apply.mockResolvedValue({ notesCreated: 1, soulError: null, errors: ['One starter could not be saved'] })
  render(<OnboardingWizard />)
  fireEvent.doubleClick(screen.getByRole('button', { name: new RegExp(PERSONAS[0].name) }))
  assert.ok(screen.getByText('/test/notes'))
  assert.equal(controls.apply.mock.calls.length, 0)
  fireEvent.click(screen.getByRole('button', { name: /Set up my pages/ }))
  await waitFor(() => assert.match(screen.getByRole('alert').textContent ?? '', /One starter/))
  assert.equal(screen.queryByText('Setup conversation'), null)
  fireEvent.click(screen.getByRole('button', { name: /Continue with saved pages/ }))
  assert.ok(screen.getByText('Setup conversation'))
})
test('the modal owns focus and composing Escape cannot accidentally dismiss setup', () => {
  render(<OnboardingWizard />)
  const dialog = screen.getByRole('dialog')
  assert.equal(dialog.ownerDocument.activeElement, dialog)
  fireEvent.keyDown(dialog, { key: 'Tab' })
  assert.ok(dialog.contains(dialog.ownerDocument.activeElement))
  fireEvent.keyDown(dialog, { key: 'Escape', isComposing: true })
  assert.equal(controls.finish.mock.calls.length, 0)
  fireEvent.keyDown(dialog, { key: 'Escape' })
  assert.equal(controls.finish.mock.calls.length, 1)
  assert.equal(controls.end.mock.calls.length, 1)
})
