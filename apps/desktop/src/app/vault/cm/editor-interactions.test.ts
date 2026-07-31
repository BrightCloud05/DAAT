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

import { $aiHint, $aiUndo, $inlineAi, undoInlineAi } from '../../notes/inline-ai-store'
import { $activeNote } from '../store'
import { setEditorView } from '../editor-bridge'
import { blockRangeAt } from './block-handles'
import { inlineAiTrigger } from './inline-ai-trigger'
import { selectionHint } from './selection-hint'
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
  $inlineAi.set({ status: 'idle', top: 0, left: 0, anchor: 0, range: null, selected: '', sessionId: null, error: null })
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
    $inlineAi.set({ status: 'idle', top: 0, left: 0, anchor: 0, range: null, selected: '', sessionId: null, error: null })
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

test('Mod-i on a selection opens in rewrite mode and captures the passage', () => {
  const doc = 'intro\n\nthe passage to fix\n\noutro'
  const from = doc.indexOf('the passage')
  const to = from + 'the passage to fix'.length
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: { anchor: from, head: to },
      extensions: [inlineAiTrigger()]
    })
  })

  setEditorView(view)
  view.contentDOM.dispatchEvent(
    // CM resolves `Mod` from the platform, and jsdom is not a Mac — so the
    // binding under test here is Ctrl-i, which is Cmd-I on the user's machine.
    new KeyboardEvent('keydown', { key: 'i', ctrlKey: true, bubbles: true, cancelable: true })
  )

  const state = $inlineAi.get()

  assert.equal(state.status, 'prompt')
  // The bug this covers: the selection was read as a bare `head`, so the
  // overlay opened in write mode and the answer was appended after the
  // paragraph instead of replacing it.
  assert.deepEqual(state.range, { from, to })
  assert.equal(state.selected, 'the passage to fix')

  setEditorView(null)
  view.destroy()
})

test('Mod-i with no selection stays in write mode', () => {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({ doc: 'hello', selection: { anchor: 5 }, extensions: [inlineAiTrigger()] })
  })

  setEditorView(view)
  view.contentDOM.dispatchEvent(
    // CM resolves `Mod` from the platform, and jsdom is not a Mac — so the
    // binding under test here is Ctrl-i, which is Cmd-I on the user's machine.
    new KeyboardEvent('keydown', { key: 'i', ctrlKey: true, bubbles: true, cancelable: true })
  )

  assert.equal($inlineAi.get().status, 'prompt')
  assert.equal($inlineAi.get().range, null)

  setEditorView(null)
  view.destroy()
})

test('selecting a passage offers the ⌘I nudge; a stray drag does not', () => {
  const doc = 'A paragraph long enough to be worth rewriting properly.\n'
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({ doc, selection: { anchor: 0 }, extensions: [selectionHint()] })
  })

  setEditorView(view)

  // A short drag is a mis-click, not a passage — nudging on it would make the
  // chip flicker under the cursor while the user is just moving around.
  view.dispatch({ selection: { anchor: 2, head: 7 } })
  assert.equal($aiHint.get().visible, false, 'a 5-char selection must not nudge')

  view.dispatch({ selection: { anchor: 2, head: 40 } })

  const hint = $aiHint.get()

  assert.equal(hint.visible, true)
  assert.equal(hint.from, 2)
  assert.equal(hint.to, 40)

  // Collapsing must take it away again.
  view.dispatch({ selection: { anchor: 40 } })
  assert.equal($aiHint.get().visible, false)

  setEditorView(null)
  view.destroy()
})

test('undo puts the original passage back', () => {
  const before = 'the passage to fix'
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({ doc: `intro\n\nAI OUTPUT\n\noutro` })
  })

  setEditorView(view)
  $activeNote.set({ path: 'n.md', content: view.state.doc.toString(), mtimeMs: 0, dataless: false })
  $aiUndo.set({ from: 7, to: 16, restore: before, notePath: 'n.md' })

  undoInlineAi()

  assert.equal(view.state.doc.toString(), `intro\n\n${before}\n\noutro`)
  assert.equal($aiUndo.get(), null, 'the offer is consumed')

  setEditorView(null)
  view.destroy()
})
