/**
 * Headless verification of the editor's interactive layers — the pieces a
 * screenshot can't show: slash-menu matching, the Space inline-AI trigger
 * (real keydown through CM's keymap, guarding the "Space" vs " " key-name
 * trap), and block-range resolution for the hover handles.
 *
 * @vitest-environment jsdom
 */

import assert from 'node:assert/strict'
import { afterEach, test } from 'vitest'

import { CompletionContext } from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

import { $inlineAi } from '../../notes/inline-ai-store'
import { setEditorView } from '../editor-bridge'
import { blockRangeAt } from './block-handles'
import { inlineAiTrigger } from './inline-ai-trigger'
import { slashSource } from './slash-menu'
import { wikiLinkExtension } from './wikilink-language'

function stateWith(doc: string, cursor: number): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown({ base: markdownLanguage, extensions: [wikiLinkExtension] })]
  })
}

afterEach(() => {
  $inlineAi.set({ status: 'idle', top: 0, left: 0, anchor: 0, sessionId: null, error: null })
})

test('slash menu matches / on an empty line and filters', async () => {
  const state = stateWith('/', 1)
  const result = await slashSource(new CompletionContext(state, 1, true))

  assert.ok(result, 'slash at line start should open the menu')
  assert.ok(result!.options.length >= 10)

  const filtered = await slashSource(new CompletionContext(stateWith('/call', 5), 5, true))

  assert.ok(filtered)
  assert.ok(filtered!.options.every(option => option.label.toLowerCase().includes('call')))

  const midWord = await slashSource(new CompletionContext(stateWith('a/', 2), 2, true))

  assert.equal(midWord, null, 'slash mid-text should not open the menu')
})

test('Space on an empty line triggers inline AI through the real keymap', () => {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: 'line one\n',
      selection: { anchor: 9 },
      extensions: [inlineAiTrigger(), markdown({ base: markdownLanguage })]
    })
  })

  setEditorView(view)

  try {
    const event = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true })

    view.contentDOM.dispatchEvent(event)

    assert.equal($inlineAi.get().status, 'prompt', 'empty-line Space must open the AI prompt')

    // Space inside text must NOT trigger (types a normal space instead).
    $inlineAi.set({ status: 'idle', top: 0, left: 0, anchor: 0, sessionId: null, error: null })
    view.dispatch({ selection: { anchor: 4 } })
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }))
    assert.equal($inlineAi.get().status, 'idle', 'Space inside text must stay a plain space')
  } finally {
    setEditorView(null)
    view.destroy()
  }
})

test('blockRangeAt resolves paragraphs and skips empty lines', () => {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: '# Title\n\npara one\npara one continued\n\n- item\n',
      extensions: [markdown({ base: markdownLanguage })]
    })
  })

  try {
    const heading = blockRangeAt(view, 2)

    assert.ok(heading)
    assert.equal(view.state.doc.sliceString(heading!.from, heading!.to), '# Title')

    const para = blockRangeAt(view, 12)

    assert.ok(para)
    assert.ok(view.state.doc.sliceString(para!.from, para!.to).startsWith('para one'))

    const empty = blockRangeAt(view, 8)

    assert.equal(empty, null, 'empty line between blocks yields no handle target')
  } finally {
    view.destroy()
  }
})
