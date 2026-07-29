/**
 * vault-parser.ts
 *
 * Extracts index facts from a markdown note: title, wikilinks, tags,
 * headings, frontmatter, and the plain text used for full-text search.
 *
 * Built on the remark pipeline (the same mdast the wider unified ecosystem
 * agrees on) so links inside code fences / inline code are NOT indexed —
 * the failure mode a regex scraper can't avoid.
 *
 * Pure functions, no Electron / no fs: callable from the main process now
 * and trivially movable into a utilityProcess worker when vault sizes
 * demand it (M2 follow-up).
 */

import matter from 'gray-matter'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { wikiLinkPlugin } from 'remark-wiki-link'
import { unified } from 'unified'

export interface ParsedLink {
  targetRaw: string
  line: number
}

export interface ParsedNote {
  title: string
  links: ParsedLink[]
  tags: string[]
  headings: string[]
  frontmatter: Record<string, unknown>
  /** Plain text (markdown syntax stripped) for the FTS index. */
  plainText: string
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ['yaml'])
  .use(wikiLinkPlugin, { aliasDivider: '|' })

// #tag — letters/digits/underscore/hyphen/slash, not preceded by a word char
// (so "issue#4" and URLs don't count). Unicode letters allowed (Korean tags).
const TAG_RE = /(^|[^\w#&])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu

interface MdastNode {
  type: string
  value?: string
  depth?: number
  children?: MdastNode[]
  position?: { start?: { line?: number } }
  data?: { alias?: string; permalink?: string }
}

function walk(node: MdastNode, visit: (node: MdastNode, insideCode: boolean) => void, insideCode = false): void {
  const nowInsideCode = insideCode || node.type === 'code' || node.type === 'inlineCode'

  visit(node, nowInsideCode)

  for (const child of node.children ?? []) {
    walk(child, visit, nowInsideCode)
  }
}

function nodeText(node: MdastNode): string {
  if (node.type === 'text' || node.type === 'inlineCode') {
    return node.value ?? ''
  }

  return (node.children ?? []).map(nodeText).join('')
}

/** Title = frontmatter `title:` → first H1 → filename (caller's fallback). */
export function parseNote(content: string, fallbackTitle: string): ParsedNote {
  let frontmatter: Record<string, unknown> = {}
  let body = content

  try {
    // The options object is load-bearing: called with no options, gray-matter
    // memoizes every distinct string it has ever parsed in a module-level
    // cache that is never evicted, so indexing a 10k-note vault pins the whole
    // vault's text in the main process for the life of the app.
    const parsed = matter(content, {})

    frontmatter = parsed.data && typeof parsed.data === 'object' ? (parsed.data as Record<string, unknown>) : {}
    body = parsed.content
  } catch {
    // Malformed YAML — index the raw body rather than dropping the note.
  }

  const links: ParsedLink[] = []
  const headings: string[] = []
  const textParts: string[] = []
  let firstH1: string | null = null

  let tree: MdastNode

  try {
    tree = processor.parse(content) as unknown as MdastNode
  } catch {
    tree = { type: 'root', children: [] }
    textParts.push(body)
  }

  walk(tree, (node, insideCode) => {
    if (node.type === 'wikiLink' && !insideCode) {
      links.push({
        targetRaw: String(node.value ?? ''),
        line: node.position?.start?.line ?? 0
      })
    }

    if (node.type === 'heading') {
      const text = nodeText(node)

      headings.push(text)

      if (node.depth === 1 && firstH1 === null) {
        firstH1 = text
      }
    }

    if (node.type === 'text' && node.value) {
      textParts.push(node.value)
    }

    // Code blocks are still searchable content, just never link/tag sources.
    if (node.type === 'code' && node.value) {
      textParts.push(node.value)
    }
  })

  const plainText = textParts.join(' ').replace(/\s+/g, ' ').trim()

  const tags = new Set<string>()

  // Tags come from the non-code plain text (so `#!/bin/bash` in a fence
  // doesn't become a tag) plus the frontmatter `tags:` field.
  for (const match of plainText.matchAll(TAG_RE)) {
    tags.add(match[2].toLowerCase())
  }

  const fmTags = frontmatter.tags

  if (Array.isArray(fmTags)) {
    for (const tag of fmTags) {
      if (typeof tag === 'string' && tag.trim()) {
        tags.add(tag.trim().replace(/^#/, '').toLowerCase())
      }
    }
  } else if (typeof fmTags === 'string' && fmTags.trim()) {
    for (const tag of fmTags.split(/[,\s]+/)) {
      if (tag.trim()) {
        tags.add(tag.trim().replace(/^#/, '').toLowerCase())
      }
    }
  }

  const fmTitle = typeof frontmatter.title === 'string' && frontmatter.title.trim() ? frontmatter.title.trim() : null

  return {
    title: fmTitle ?? firstH1 ?? fallbackTitle,
    links,
    tags: [...tags],
    headings,
    frontmatter,
    plainText
  }
}
