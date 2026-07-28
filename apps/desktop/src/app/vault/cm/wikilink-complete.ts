/**
 * Wikilink autocomplete: typing `[[` offers every note in the vault (name +
 * title, most-recently-edited first — the list the index already maintains).
 * Selecting inserts `Target]]`.
 */

import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import type { Extension } from '@codemirror/state'

interface NoteName {
  path: string
  title: string
  name: string
}

let cache: NoteName[] = []
let cacheAt = 0

async function noteNames(): Promise<NoteName[]> {
  if (Date.now() - cacheAt > 3_000) {
    try {
      cache = await window.hermesDesktop.vault.noteNames()
      cacheAt = Date.now()
    } catch {
      // Vault closed — keep whatever we had.
    }
  }

  return cache
}

async function wikilinkSource(context: CompletionContext): Promise<CompletionResult | null> {
  const before = context.matchBefore(/\[\[([^\][|#]*)$/)

  if (!before) {
    return null
  }

  const names = await noteNames()

  if (!names.length) {
    return null
  }

  const seen = new Set<string>()
  const options = []

  for (const note of names) {
    const label = note.title || note.name

    if (seen.has(label.toLowerCase())) {
      continue
    }

    seen.add(label.toLowerCase())
    options.push({
      label,
      detail: note.path,
      type: 'text',
      apply: `${label}]]`
    })
  }

  return {
    from: before.from + 2,
    options,
    // Keep completing while the user types inside the brackets.
    validFor: /^[^\][|#]*$/
  }
}

export function wikilinkCompletion(): Extension {
  return autocompletion({
    override: [wikilinkSource],
    icons: false,
    activateOnTyping: true
  })
}
