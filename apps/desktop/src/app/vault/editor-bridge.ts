/**
 * Bridge exposing the live CodeMirror view to shell surfaces (properties
 * panel, future inline-AI) so they can edit the document through CM
 * transactions — the editor stays the single source of truth and autosave
 * flows through the normal update listener.
 */

import type { EditorView } from '@codemirror/view'
import { atom } from 'nanostores'

export const $editorView = atom<EditorView | null>(null)

/** Bumped on every doc change so panels re-derive from the live document. */
export const $docEpoch = atom(0)

export function setEditorView(view: EditorView | null): void {
  $editorView.set(view)
}

export function bumpDocEpoch(): void {
  $docEpoch.set($docEpoch.get() + 1)
}
