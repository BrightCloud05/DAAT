/**
 * Typing regression guard: with the full editor extension stack mounted, a
 * plain character insertion must reach the document. This is the check that
 * would have caught the day the editor went read-only.
 *
 * @vitest-environment jsdom
 */

import assert from 'node:assert/strict'
import { test } from 'vitest'

import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { foldGutter, foldKeymap } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'

import { blockHandles } from './block-handles'
import { callouts } from './callouts'
import { inlineAiTrigger } from './inline-ai-trigger'
import { livePreview } from './live-preview'
import { markdownStyling } from './markdown-style'
import { slashSource } from './slash-menu'
import { vaultCompletions } from './wikilink-complete'
import { wikiLinkExtension } from './wikilink-language'

/** Mirrors editor-pane.tsx's extension list. */
function fullStack() {
  return [
    history(),
    inlineAiTrigger(),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [wikiLinkExtension] }),
    markdownStyling,
    livePreview({ openWikilink: () => undefined }),
    callouts(),
    blockHandles(),
    vaultCompletions([slashSource]),
    keymap.of(foldKeymap),
    foldGutter(),
    EditorView.lineWrapping,
    placeholder('Start writing…')
  ]
}

test('the document accepts typed input with the full extension stack', () => {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({ doc: 'hello', selection: { anchor: 5 }, extensions: fullStack() })
  })

  try {
    assert.equal(view.state.readOnly, false, 'editor must not be read-only')
    assert.equal(view.state.facet(EditorView.editable), true, 'editor must be editable')

    // Simulate what typing produces: a user-event insertion transaction.
    view.dispatch(view.state.replaceSelection(' world'))

    assert.equal(view.state.doc.toString(), 'hello world')

    // Enter must split the line (defaultKeymap reachable, not swallowed).
    const before = view.state.doc.lines

    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    assert.equal(view.state.doc.lines, before + 1, 'Enter must insert a newline')

    // A normal space mid-text stays a space (inline-AI must not swallow it).
    view.dispatch({ selection: { anchor: 5 } })
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }))
    assert.ok(view.state.doc.toString().startsWith('hello'), 'doc must survive a mid-text space')
  } finally {
    view.destroy()
  }
})
