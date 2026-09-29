/**
 * Inline AI triggers: Space on an empty line (Notion's gesture) and Mod-i
 * anywhere. Opens the prompt overlay at the cursor; the store owns the rest.
 */

import type { Extension } from '@codemirror/state'
import { keymap } from '@codemirror/view'

import { openInlineAiAt } from '../../notes/inline-ai-store'

export function inlineAiTrigger(): Extension {
  return keymap.of([
    {
      // NB: the literal ' ' — CM keymaps match KeyboardEvent.key, and the
      // space bar's key value is a space character, not the string "Space".
      key: ' ',
      run: view => {
        const { head, empty } = view.state.selection.main

        // A note whose contents are still coming down from iCloud opens as an
        // empty document — which is exactly the shape this gesture fires on.
        // Offering to write into it invites the model to fill a page whose
        // real text is elsewhere, and the save will be refused anyway.
        if (view.state.readOnly || !empty) {
          return false
        }

        const line = view.state.doc.lineAt(head)

        if (line.text.trim() !== '' || head !== line.to) {
          return false
        }

        openInlineAiAt(head)

        return true
      }
    },
    {
      key: 'Mod-i',
      run: view => {
        if (view.state.readOnly) {
          return false
        }

        const { from, to } = view.state.selection.main

        // With text selected this is "rewrite this", not "write something
        // here" — the selection used to be dropped on the floor, so asking
        // to shorten a paragraph appended a second one instead.
        openInlineAiAt(to, from === to ? undefined : { from, to })

        return true
      }
    }
  ])
}
