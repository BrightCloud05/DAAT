import assert from 'node:assert/strict'

import { EditorState } from '@codemirror/state'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, test, vi } from 'vitest'
vi.mock('../vault/store', async () => ({
  $activeNote: (await import('nanostores')).atom({ path: 'Example.md', content: '' })
}))
import { $editorView } from '../vault/editor-bridge'

import { PropertiesPanel } from './properties-panel'
afterEach(() => {
  cleanup()
  $editorView.set(null)
})
test('composing Enter preserves a property draft and Escape cancels without committing on blur', () => {
  const state = EditorState.create({ doc: '---\nstatus: draft\n---\nBody' })
  const dispatch = vi.fn()
  $editorView.set({ state, dispatch } as unknown as NonNullable<ReturnType<typeof $editorView.get>>)
  render(<PropertiesPanel />)
  const input = screen.getByRole('textbox', { name: 'status' })
  act(() => input.focus())
  fireEvent.change(input, { target: { value: '수정중' } })
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  assert.equal(input.ownerDocument.activeElement, input)
  assert.equal(dispatch.mock.calls.length, 0)
  fireEvent.keyDown(input, { key: 'Escape' })
  assert.equal(dispatch.mock.calls.length, 0)
  assert.equal((input as HTMLInputElement).value, 'draft')
  act(() => input.focus())
  fireEvent.change(input, { target: { value: 'done' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  assert.equal(dispatch.mock.calls.length, 1)
  assert.ok(state.update(dispatch.mock.calls[0][0]).state.doc.toString().includes('status: done'))
})
