/**
 * Live preview: hide markdown syntax marks except on the line(s) the cursor
 * touches — the Obsidian/Typora reading-while-editing feel. Decorations are
 * derived from the lezer syntax tree (never regex), so code blocks and
 * frontmatter stay verbatim.
 *
 * Also owns wikilink interaction: cmd/ctrl-click (or plain click when the
 * cursor is elsewhere) opens the target through the handler the editor pane
 * injects.
 */

import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Extension, type Range, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

import { splitWikilink } from './wikilink-language'

/** Node names whose text is hidden when the cursor is away. */
const HIDDEN_MARKS = new Set([
  'HeaderMark',
  'EmphasisMark',
  'CodeMark',
  'StrikethroughMark',
  'WikiLinkMark',
  'LinkMark'
])

const hideMark = Decoration.replace({})
const urlHide = Decoration.replace({})

/**
 * Line numbers the selection touches, clipped to what's on screen.
 *
 * Unclipped, ⌘A on a long note builds a Set with one entry per line on every
 * keystroke. Off-screen lines can't show their syntax marks anyway.
 */
function selectionLines(view: EditorView): Set<number> {
  const lines = new Set<number>()
  const doc = view.state.doc
  const first = view.visibleRanges.length ? doc.lineAt(view.visibleRanges[0].from).number : 1
  const last = view.visibleRanges.length
    ? doc.lineAt(view.visibleRanges[view.visibleRanges.length - 1].to).number
    : doc.lines

  for (const range of view.state.selection.ranges) {
    const from = Math.max(first, doc.lineAt(range.from).number)
    const to = Math.min(last, doc.lineAt(range.to).number)

    for (let line = from; line <= to; line++) {
      lines.add(line)
    }
  }

  return lines
}

/**
 * Whole-line span of the leading `---` YAML block, or null. The properties
 * panel renders it as Notion-style rows, so the raw block is folded out of
 * the document (still in the file, one click from view when the cursor
 * enters). `to` is the last line's end — no trailing newline, because a block
 * replacement must cover entire lines.
 */
function frontmatterRange(state: EditorState): { from: number; to: number; lastLine: number } | null {
  const doc = state.doc

  if (doc.lines < 3 || doc.line(1).text.trim() !== '---') {
    return null
  }

  for (let lineNo = 2; lineNo <= Math.min(doc.lines, 200); lineNo++) {
    if (doc.line(lineNo).text.trim() === '---') {
      // Folding the entire document would leave nowhere to click to unfold.
      if (lineNo >= doc.lines) {
        return null
      }

      return { from: 0, to: doc.line(lineNo).to, lastLine: lineNo }
    }
  }

  return null
}

/**
 * The frontmatter fold lives in a StateField, not the ViewPlugin below.
 *
 * CodeMirror forbids block decorations (and any decoration spanning a line
 * break) from a plugin — it throws a RangeError out of `view.dispatch` the
 * first time one is emitted. Only a state field may provide them.
 */
const frontmatterFold = StateField.define<DecorationSet>({
  create: state => foldFor(state),
  update: (value, tr) => (tr.docChanged || tr.selection ? foldFor(tr.state) : value),
  provide: field => EditorView.decorations.from(field)
})

function foldFor(state: EditorState): DecorationSet {
  const range = frontmatterRange(state)

  if (!range) {
    return Decoration.none
  }

  // Keep it open while the cursor is inside, so it stays editable by hand.
  const cursorInside = state.selection.ranges.some(sel => sel.from <= range.to && sel.to >= range.from)

  if (cursorInside) {
    return Decoration.none
  }

  return Decoration.set([Decoration.replace({ block: true }).range(range.from, range.to)])
}

function buildDecorations(view: EditorView): DecorationSet {
  const decorations: Range<Decoration>[] = []
  const activeLines = selectionLines(view)
  const doc = view.state.doc

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: node => {
        const line = doc.lineAt(node.from).number
        const cursorHere = activeLines.has(line)

        if (HIDDEN_MARKS.has(node.name) && !cursorHere) {
          // Header marks swallow the following space too ("# " -> "").
          const end =
            node.name === 'HeaderMark' && doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to

          decorations.push(hideMark.range(node.from, end))
        }

        // Inline links: hide the (url) part when away; the title stays.
        if (node.name === 'URL' && !cursorHere && node.node.parent?.name === 'Link') {
          decorations.push(urlHide.range(node.from, node.to))
        }
      }
    })
  }

  return Decoration.set(
    decorations.sort((a, b) => a.from - b.from || (a.value.startSide ?? 0) - (b.value.startSide ?? 0)),
    true
  )
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  { decorations: plugin => plugin.decorations }
)

export interface LivePreviewOptions {
  openWikilink: (target: string) => void
}

function wikilinkAt(view: EditorView, pos: number): string | null {
  let found: string | null = null

  syntaxTree(view.state).iterate({
    from: pos,
    to: pos,
    enter: node => {
      if (node.name === 'WikiLink') {
        found = view.state.doc.sliceString(node.from + 2, node.to - 2)
      }
    }
  })

  return found
}

export function livePreview(options: LivePreviewOptions): Extension {
  return [
    frontmatterFold,
    livePreviewPlugin,
    EditorView.domEventHandlers({
      mousedown: (event, view) => {
        // Plain click navigates (Notion/Obsidian preview behavior); the
        // modifier is only needed when editing the link's own line.
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })

        if (pos === null) {
          return false
        }

        const inner = wikilinkAt(view, pos)

        if (!inner) {
          return false
        }

        const onActiveLine = selectionLines(view).has(view.state.doc.lineAt(pos).number)

        if (onActiveLine && !(event.metaKey || event.ctrlKey)) {
          return false
        }

        event.preventDefault()
        options.openWikilink(splitWikilink(inner).target)

        return true
      }
    }),
    EditorView.theme({
      '.cm-content .cm-widgetBuffer': { display: 'inline' }
    })
  ]
}
