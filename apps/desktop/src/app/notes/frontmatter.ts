/**
 * Frontmatter block helpers for the properties panel: locate the leading
 * YAML block in a document, parse it, and produce replacement text for a
 * property edit. Pure functions over strings — applied via CM transactions.
 */

import yaml from 'js-yaml'

export interface FrontmatterBlock {
  /** Char range of the whole block including delimiters, or null if absent. */
  from: number
  to: number
  props: Record<string, unknown>
}

const BLOCK_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

export function readFrontmatter(content: string): FrontmatterBlock | null {
  const match = BLOCK_RE.exec(content)

  if (!match) {
    return null
  }

  try {
    // js-yaml v4: `load` IS the former safeLoad (DEFAULT_SCHEMA, no code
    // execution); the unsafe loader was removed from the API entirely.
    const parsed = yaml.load(match[1])

    return {
      from: 0,
      to: match[0].length,
      props: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
    }
  } catch {
    return null
  }
}

function dumpBlock(props: Record<string, unknown>): string {
  if (!Object.keys(props).length) {
    return ''
  }

  return `---\n${yaml.dump(props, { lineWidth: 120 }).trimEnd()}\n---\n`
}

/**
 * New full-block text after setting (or deleting, when value === undefined)
 * a property. Returns the replacement range + text for a CM dispatch.
 */
export function propertyEdit(
  content: string,
  key: string,
  value: unknown
): { from: number; to: number; insert: string } {
  const block = readFrontmatter(content)
  const props = { ...(block?.props ?? {}) }

  if (value === undefined) {
    delete props[key]
  } else {
    props[key] = value
  }

  return { from: block?.from ?? 0, to: block?.to ?? 0, insert: dumpBlock(props) }
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
