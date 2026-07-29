/**
 * Markdown typography for the vault editor: a HighlightStyle over the lezer
 * markdown tags. Rides the app's design tokens (--ui-*, --dt-*) so every
 * theme — including Daat Glass — styles the document consistently.
 */

import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { tags as t } from '@lezer/highlight'

import { wikilinkMarkTag, wikilinkTag } from './wikilink-language'

const headings = [
  { tag: t.heading1, fontSize: '1.6em', fontWeight: '700' },
  { tag: t.heading2, fontSize: '1.35em', fontWeight: '700' },
  { tag: t.heading3, fontSize: '1.18em', fontWeight: '650' },
  { tag: t.heading4, fontSize: '1.06em', fontWeight: '650' },
  { tag: t.heading5, fontSize: '1em', fontWeight: '650' },
  { tag: t.heading6, fontSize: '1em', fontWeight: '650', color: 'var(--ui-text-tertiary)' }
]

const markdownHighlight = HighlightStyle.define([
  ...headings.map(h => ({ ...h, lineHeight: '1.35' })),
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--ui-text-tertiary)' },
  { tag: t.monospace, fontFamily: 'var(--dt-font-mono)', fontSize: '0.9em' },
  { tag: t.link, color: 'var(--dt-primary)' },
  { tag: t.url, color: 'var(--ui-text-tertiary)' },
  { tag: t.quote, color: 'var(--ui-text-secondary)' },
  { tag: t.list, color: 'var(--dt-primary)' },
  { tag: t.meta, color: 'var(--ui-text-quaternary)' },
  { tag: t.processingInstruction, color: 'var(--ui-text-quaternary)' },
  { tag: t.contentSeparator, color: 'var(--ui-text-quaternary)' },
  { tag: wikilinkTag, color: 'var(--dt-primary)' },
  { tag: wikilinkMarkTag, color: 'var(--ui-text-quaternary)' }
])

export const markdownStyling: Extension = syntaxHighlighting(markdownHighlight)
