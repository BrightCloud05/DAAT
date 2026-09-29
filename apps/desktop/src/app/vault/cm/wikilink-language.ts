/**
 * Lezer-markdown inline extension parsing Obsidian-style [[wikilinks]]
 * ([[Target]], [[Target|label]], [[Target#Heading]]) into WikiLink nodes so
 * live-preview decorations and click handling work off the syntax tree —
 * never regexes over raw text (code fences stay inert for free).
 */

import { Tag } from '@lezer/highlight'
import type { MarkdownConfig } from '@lezer/markdown'

export const wikilinkTag = Tag.define()
export const wikilinkMarkTag = Tag.define()

const BRACKET_OPEN = 91 // [
const BRACKET_CLOSE = 93 // ]
const NEWLINE = 10

export const wikiLinkExtension: MarkdownConfig = {
  defineNodes: [
    { name: 'WikiLink', style: wikilinkTag },
    { name: 'WikiLinkMark', style: wikilinkMarkTag }
  ],
  parseInline: [
    {
      name: 'WikiLink',
      before: 'Link',
      parse(cx, next, pos) {
        if (next !== BRACKET_OPEN || cx.char(pos + 1) !== BRACKET_OPEN) {
          return -1
        }

        let end = pos + 2

        while (end < cx.end) {
          const ch = cx.char(end)

          if (ch === NEWLINE) {
            return -1
          }

          if (ch === BRACKET_CLOSE && cx.char(end + 1) === BRACKET_CLOSE) {
            if (end === pos + 2) {
              return -1 // [[]] — empty, not a link
            }

            return cx.addElement(
              cx.elt('WikiLink', pos, end + 2, [
                cx.elt('WikiLinkMark', pos, pos + 2),
                cx.elt('WikiLinkMark', end, end + 2)
              ])
            )
          }

          end++
        }

        return -1
      }
    }
  ]
}

/** "Target|label" -> {target, label}; heading fragments stay in target. */
export function splitWikilink(inner: string): { target: string; label: string } {
  const pipe = inner.indexOf('|')

  if (pipe === -1) {
    return { target: inner.trim(), label: inner.trim() }
  }

  return { target: inner.slice(0, pipe).trim(), label: inner.slice(pipe + 1).trim() }
}
