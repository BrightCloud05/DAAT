/**
 * Tells the store where the current selection is, so the editor can offer
 * "⌘I to edit" next to it.
 *
 * The inline assistant was complete and working long before anyone could find
 * it, because a keyboard shortcut with nothing on screen is a feature only its
 * author knows about. Selecting text is the moment the user has already
 * decided this passage needs work — the cheapest possible place to mention it.
 *
 * This is a plain update listener, not a decoration: the nudge is a React
 * overlay positioned over the editor, so nothing is inserted into the document
 * and there is no risk of the block-decoration-from-a-ViewPlugin trap.
 */

import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

import { $inlineAi, hideAiHint, setAiHint } from '../../notes/inline-ai-store'

/** Below this, a "selection" is a stray drag rather than a passage. */
const MIN_CHARS = 12

export function selectionHint(): Extension {
  return EditorView.updateListener.of(update => {
    if (!update.selectionSet && !update.docChanged && !update.focusChanged) {
      return
    }

    const { from, to } = update.state.selection.main

    // Never compete with the prompt bubble for the same corner of the screen.
    if (from === to || to - from < MIN_CHARS || $inlineAi.get().status !== 'idle') {
      hideAiHint()

      return
    }

    // Whether to offer the nudge is a question about the selection; where to
    // draw it is a question about layout. Keeping them separate means a
    // measurement that fails — a position not yet laid out, a detached view —
    // costs the user a well-placed chip, not the entire affordance.
    let coords: { top: number; bottom: number; left: number } | null = null

    try {
      coords = update.view.coordsAtPos(from)
    } catch {
      coords = null
    }

    const host = update.view.dom.getBoundingClientRect()

    setAiHint({
      visible: true,
      // Above the first line of the selection, so it never covers the text
      // the user is looking at.
      top: coords ? coords.top - host.top - 34 : 8,
      left: coords ? Math.max(8, coords.left - host.left) : 8,
      from,
      to
    })
  })
}
