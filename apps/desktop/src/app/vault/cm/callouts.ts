/**
 * Callout rendering: Obsidian's `> [!type] Title` (and foldable `[!type]-`)
 * blockquotes styled Notion-pretty — tinted block, icon, hidden `>` marks
 * when the cursor is away. Syntax stays plain markdown on disk.
 */

import { syntaxTree } from '@codemirror/language'
import type { Extension, Range } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType
} from '@codemirror/view'

const CALLOUT_RE = /^>\s*\[!(\w+)\](-?)\s*(.*)$/

const TYPE_STYLE: Record<string, { icon: string; tone: string }> = {
  note: { icon: '✏️', tone: 'note' },
  info: { icon: 'ℹ️', tone: 'note' },
  tip: { icon: '💡', tone: 'tip' },
  hint: { icon: '💡', tone: 'tip' },
  success: { icon: '✅', tone: 'tip' },
  warning: { icon: '⚠️', tone: 'warning' },
  caution: { icon: '⚠️', tone: 'warning' },
  danger: { icon: '🚫', tone: 'danger' },
  error: { icon: '🚫', tone: 'danger' },
  question: { icon: '❓', tone: 'note' },
  quote: { icon: '💬', tone: 'note' }
}

class CalloutIconWidget extends WidgetType {
  constructor(private icon: string) {
    super()
  }

  eq(other: CalloutIconWidget): boolean {
    return other.icon === this.icon
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span')

    span.className = 'cm-callout-icon'
    span.textContent = this.icon

    return span
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const decorations: Range<Decoration>[] = []
  const doc = view.state.doc
  const cursorLines = new Set(view.state.selection.ranges.map(range => doc.lineAt(range.head).number))

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: node => {
        if (node.name !== 'Blockquote') {
          return
        }

        const firstLine = doc.lineAt(node.from)
        const match = CALLOUT_RE.exec(firstLine.text)

        if (!match) {
          return
        }

        const [, type, , title] = match
        const style = TYPE_STYLE[type.toLowerCase()] ?? TYPE_STYLE.note
        const lastLine = doc.lineAt(node.to)

        for (let lineNo = firstLine.number; lineNo <= lastLine.number; lineNo++) {
          const line = doc.line(lineNo)
          const position =
            firstLine.number === lastLine.number
              ? 'only'
              : lineNo === firstLine.number
                ? 'first'
                : lineNo === lastLine.number
                  ? 'last'
                  : 'middle'

          decorations.push(
            Decoration.line({ class: `cm-callout cm-callout-${style.tone} cm-callout-${position}` }).range(line.from)
          )

          // Hide the "> " prefix + "[!type]" marker when the cursor is away.
          if (!cursorLines.has(lineNo)) {
            const prefix = /^>\s?/.exec(line.text)

            if (prefix) {
              decorations.push(Decoration.replace({}).range(line.from, line.from + prefix[0].length))
            }

            if (lineNo === firstLine.number) {
              const markStart = line.from + line.text.indexOf('[!')
              const markEnd = line.from + line.text.indexOf(']') + 1
              const foldDash = line.text.charAt(line.text.indexOf(']') + 1) === '-' ? 1 : 0

              if (markStart > line.from - 1 && markEnd > markStart) {
                decorations.push(
                  Decoration.replace({ widget: new CalloutIconWidget(style.icon) }).range(
                    markStart,
                    Math.min(markEnd + foldDash + (line.text.charAt(line.text.indexOf(']') + 1 + foldDash) === ' ' ? 1 : 0), line.to)
                  )
                )
              }

              if (title) {
                const titleStart = line.from + line.text.lastIndexOf(title)

                decorations.push(Decoration.mark({ class: 'cm-callout-title' }).range(titleStart, line.to))
              }
            }
          }
        }
      }
    })
  }

  return Decoration.set(
    decorations.sort((a, b) => a.from - b.from || (a.value.startSide ?? 0) - (b.value.startSide ?? 0)),
    true
  )
}

const calloutPlugin = ViewPlugin.fromClass(
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

const calloutTheme = EditorView.baseTheme({
  '.cm-callout': {
    backgroundColor: 'color-mix(in srgb, var(--dt-primary) 6%, transparent)',
    borderLeft: '3px solid color-mix(in srgb, var(--dt-primary) 45%, transparent)',
    paddingLeft: '0.75rem'
  },
  '.cm-callout-first, .cm-callout-only': {
    borderTopLeftRadius: '8px',
    borderTopRightRadius: '8px',
    paddingTop: '0.3rem'
  },
  '.cm-callout-last, .cm-callout-only': {
    borderBottomLeftRadius: '8px',
    borderBottomRightRadius: '8px',
    paddingBottom: '0.3rem'
  },
  '.cm-callout-tip': {
    backgroundColor: 'color-mix(in srgb, #30d158 8%, transparent)',
    borderLeftColor: 'color-mix(in srgb, #30d158 55%, transparent)'
  },
  '.cm-callout-warning': {
    backgroundColor: 'color-mix(in srgb, #ff9f0a 9%, transparent)',
    borderLeftColor: 'color-mix(in srgb, #ff9f0a 55%, transparent)'
  },
  '.cm-callout-danger': {
    backgroundColor: 'color-mix(in srgb, #ff453a 8%, transparent)',
    borderLeftColor: 'color-mix(in srgb, #ff453a 55%, transparent)'
  },
  '.cm-callout-icon': {
    marginRight: '0.4rem'
  },
  '.cm-callout-title': {
    fontWeight: '650'
  }
})

export function callouts(): Extension {
  return [calloutPlugin, calloutTheme]
}
