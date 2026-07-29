/**
 * Frontmatter block helpers for the properties panel: locate the leading
 * YAML block in a document, parse it, and produce replacement text for a
 * property edit. Pure functions over strings — applied via CM transactions.
 *
 * Edits splice the single line that changed rather than re-dumping the block.
 * The file is the user's, and a round-trip through js-yaml silently drops
 * their comments, reorders their keys and reformats their values.
 */

import yaml from 'js-yaml'

export interface FrontmatterBlock {
  /** Char range of the whole block including delimiters. */
  from: number
  to: number
  /** Char range of the YAML text between the delimiters. */
  bodyFrom: number
  bodyTo: number
  props: Record<string, unknown>
  /**
   * 'ok'      — parsed to a map; safe to edit.
   * 'invalid' — the YAML doesn't parse. Never rewrite it: we'd either bury
   *             the user's broken text under a second block or delete it.
   * 'other'   — valid YAML but a list/scalar, not a property map.
   */
  kind: 'ok' | 'invalid' | 'other'
}

const BLOCK_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/
/** A top-level key line: no indentation, `name:` at the start. */
const TOP_KEY_RE = /^([^\s#][^:\r\n]*):/

export function readFrontmatter(content: string): FrontmatterBlock | null {
  const match = BLOCK_RE.exec(content)

  if (!match) {
    return null
  }

  const bodyFrom = match[0].indexOf('\n') + 1
  const base = { from: 0, to: match[0].length, bodyFrom, bodyTo: bodyFrom + match[1].length }

  try {
    // js-yaml v4: `load` IS the former safeLoad (DEFAULT_SCHEMA, no code
    // execution); the unsafe loader was removed from the API entirely.
    const parsed = yaml.load(match[1])

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ...base, kind: 'ok', props: parsed as Record<string, unknown> }
    }

    return { ...base, kind: 'other', props: {} }
  } catch {
    return { ...base, kind: 'invalid', props: {} }
  }
}

/** Lines of `body` that belong to top-level key `key`, or null. */
function keyLineRange(body: string, key: string): { start: number; end: number } | null {
  const lines = body.split('\n')
  let start = -1

  for (let index = 0; index < lines.length; index++) {
    const match = TOP_KEY_RE.exec(lines[index])

    if (!match) {
      continue
    }

    if (start !== -1) {
      // The next top-level key ends the previous one's block.
      return { start, end: index }
    }

    if (match[1].trim() === key) {
      start = index
    }
  }

  return start === -1 ? null : { start, end: lines.length }
}

function renderPair(key: string, value: unknown): string {
  return yaml.dump({ [key]: value }, { lineWidth: 120 }).replace(/\n+$/, '')
}

/**
 * Replacement range + text for setting (or deleting, when value === undefined)
 * a property. Returns null when the edit must not be attempted — the caller
 * shows the raw block instead of corrupting it.
 */
export function propertyEdit(
  content: string,
  key: string,
  value: unknown
): { from: number; to: number; insert: string } | null {
  const block = readFrontmatter(content)

  if (!block) {
    // No block at all: create one above the body.
    return value === undefined ? null : { from: 0, to: 0, insert: `---\n${renderPair(key, value)}\n---\n` }
  }

  if (block.kind !== 'ok') {
    return null
  }

  const body = content.slice(block.bodyFrom, block.bodyTo)
  const lines = body.split('\n')
  const existing = keyLineRange(body, key)

  if (existing) {
    lines.splice(existing.start, existing.end - existing.start, ...(value === undefined ? [] : [renderPair(key, value)]))
  } else if (value !== undefined) {
    lines.push(renderPair(key, value))
  } else {
    return null
  }

  const next = lines.filter((line, index) => line !== '' || index < lines.length - 1).join('\n')

  // Emptying the last property removes the block rather than leaving `---\n---`.
  if (!next.trim()) {
    return { from: block.from, to: block.to, insert: '' }
  }

  return { from: block.bodyFrom, to: block.bodyTo, insert: next }
}

/** Best-effort scalar coercion for text inputs: numbers/booleans/dates stay typed. */
export function coerceScalar(text: string): unknown {
  const trimmed = text.trim()

  if (!trimmed) return ''
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)

  return trimmed
}
