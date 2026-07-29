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

let epochQueued = false

export function setEditorView(view: EditorView | null): void {
  $editorView.set(view)
}

/**
 * Coalesce to one notification per frame.
 *
 * Three panels subscribe to this and each re-reads the document when it
 * fires. Bumping it synchronously per keystroke made a large note re-render
 * (and re-materialize) the whole document several times between frames, for
 * output the user could never see.
 */
export function bumpDocEpoch(): void {
  if (epochQueued) {
    return
  }

  epochQueued = true

  const flush = () => {
    epochQueued = false
    $docEpoch.set($docEpoch.get() + 1)
  }

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(flush)
  } else {
    setTimeout(flush, 16)
  }
}
