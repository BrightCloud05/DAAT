/**
 * Slash block menu — Notion's signature interaction. Typing `/` at the start
 * of a line opens a block palette; picking an entry inserts the markdown for
 * that block with the cursor placed via snippet fields. Everything inserted
 * is plain markdown (Obsidian-compatible; callout/toggle use the
 * `> [!type]` / `> [!type]-` syntax), so files stay portable.
 */

import { type Completion, type CompletionContext, type CompletionResult, snippet } from '@codemirror/autocomplete'

interface BlockDef {
  label: string
  detail: string
  keywords: string
  template: string
}

const BLOCKS: BlockDef[] = [
  { label: 'Text', detail: 'Plain paragraph', keywords: 'text paragraph plain', template: '${}' },
  { label: 'Heading 1', detail: 'Large section heading', keywords: 'h1 heading title 제목', template: '# ${}' },
  { label: 'Heading 2', detail: 'Medium section heading', keywords: 'h2 heading 제목', template: '## ${}' },
  { label: 'Heading 3', detail: 'Small section heading', keywords: 'h3 heading 제목', template: '### ${}' },
  { label: 'Bulleted list', detail: '• Simple list', keywords: 'bullet list ul 목록', template: '- ${}' },
  { label: 'Numbered list', detail: '1. Ordered list', keywords: 'number ordered ol 번호', template: '1. ${}' },
  { label: 'To-do list', detail: '☐ Checkbox task', keywords: 'todo task checkbox check 할일', template: '- [ ] ${}' },
  {
    label: 'Toggle',
    detail: '▸ Collapsible block',
    keywords: 'toggle collapse fold 접기',
    template: '> [!note]- ${Title}\n> ${}'
  },
  { label: 'Quote', detail: 'Block quote', keywords: 'quote blockquote 인용', template: '> ${}' },
  {
    label: 'Callout · Note',
    detail: 'Highlighted info block',
    keywords: 'callout note info 콜아웃',
    template: '> [!note] ${Title}\n> ${}'
  },
  {
    label: 'Callout · Tip',
    detail: 'Highlighted tip block',
    keywords: 'callout tip hint 팁',
    template: '> [!tip] ${Title}\n> ${}'
  },
  {
    label: 'Callout · Warning',
    detail: 'Highlighted warning block',
    keywords: 'callout warning caution 경고',
    template: '> [!warning] ${Title}\n> ${}'
  },
  { label: 'Code block', detail: 'Fenced code with syntax', keywords: 'code fence 코드', template: '```${lang}\n${}\n```' },
  { label: 'Divider', detail: 'Horizontal rule', keywords: 'divider rule hr line 구분선', template: '---\n${}' },
  {
    label: 'Table',
    detail: 'Markdown table',
    keywords: 'table grid 표',
    template: '| ${Column} | Column |\n| --- | --- |\n| ${} |  |'
  },
  { label: 'Link to page', detail: '[[Wikilink]] to another note', keywords: 'link page wikilink 링크', template: '[[${}]]' }
]

const OPTIONS: Completion[] = BLOCKS.map(block => ({
  label: block.label,
  detail: block.detail,
  type: 'keyword',
  // Match against label + keywords (Korean included) regardless of casing.
  boost: block.label === 'Text' ? -1 : 0,
  apply: (view, _completion, from, to) => {
    // Replace from the slash itself (from is already at the `/`).
    snippet(block.template)(view, _completion, from, to)
  },
  info: undefined,
  section: undefined,
  // Custom filter text: CM matches on label by default; widen it.
  displayLabel: block.label
}))

const KEYWORDS = new Map(BLOCKS.map(block => [block.label, `${block.label} ${block.keywords}`.toLowerCase()]))

export function slashSource(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos)
  const beforeText = context.state.sliceDoc(line.from, context.pos)
  const match = /^\s*\/([\w\p{L}-]*)$/u.exec(beforeText)

  if (!match) {
    return null
  }

  const query = match[1].toLowerCase()
  const slashPos = line.from + beforeText.lastIndexOf('/')

  const options = query
    ? OPTIONS.filter(option => KEYWORDS.get(option.label)?.includes(query))
    : OPTIONS

  if (!options.length) {
    return null
  }

  return {
    from: slashPos,
    options,
    filter: false
  }
}
