/**
 * Shared vault-todos cache: one scan feeds the Home widget, the sidebar
 * count, and the future Todo screen. Refreshes when the vault notes change.
 */

import { atom } from 'nanostores'

import { $editorView } from '../vault/editor-bridge'
import { $activeNote, $vaultNotes } from '../vault/store'

export interface VaultTodo {
  path: string
  line: number
  text: string
  done: boolean
}

export const $vaultTodos = atom<VaultTodo[]>([])

let wired = false
let inFlight = false
let refreshTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Flip the checkbox in the open editor instead of on disk.
 *
 * Returns false when the line no longer looks like the task the user clicked
 * (they edited it since the last scan), so the caller can fall back.
 */
function toggleInEditor(todo: VaultTodo): boolean {
  const view = $editorView.get()

  if (!view || todo.line < 1 || todo.line > view.state.doc.lines) {
    return false
  }

  const line = view.state.doc.line(todo.line)
  const match = /^(\s*[-*]\s+\[)([ xX])(\]\s+)(.+)$/.exec(line.text)

  if (!match || match[4].trim() !== todo.text) {
    return false
  }

  const from = line.from + match[1].length

  view.dispatch({ changes: { from, to: from + 1, insert: match[2] === ' ' ? 'x' : ' ' } })

  $vaultTodos.set(
    $vaultTodos.get().map(item =>
      item.path === todo.path && item.line === todo.line ? { ...item, done: !item.done } : item
    )
  )

  return true
}

export async function refreshTodos(): Promise<void> {
  if (inFlight) {
    return
  }

  inFlight = true

  try {
    $vaultTodos.set(await window.hermesDesktop.vault.todos(100))
  } catch {
    // Vault closed — keep last known.
  } finally {
    inFlight = false
  }
}

export function initTodosStore(): void {
  if (wired) {
    return
  }

  wired = true

  // $vaultNotes gets a brand-new array on every index event — including the
  // watcher echo of the user's own autosave — and each refresh reads up to
  // 300 files from disk. Debounced, typing costs one scan instead of one per
  // keystroke-batch.
  $vaultNotes.subscribe(() => {
    if (refreshTimer) {
      clearTimeout(refreshTimer)
    }

    refreshTimer = setTimeout(() => void refreshTodos(), 750)
  })
}

export async function toggleTodo(todo: VaultTodo): Promise<void> {
  // The note may be open with unsaved edits. Rewriting it from disk would
  // both lose those edits and push the editor into a conflict copy, so route
  // the toggle through the editor when it owns the file.
  if ($activeNote.get()?.path === todo.path && toggleInEditor(todo)) {
    return
  }

  const ok = await window.hermesDesktop.vault.toggleTodo(todo.path, todo.line, todo.text)

  if (ok) {
    $vaultTodos.set(
      $vaultTodos.get().map(item =>
        item.path === todo.path && item.line === todo.line ? { ...item, done: !item.done } : item
      )
    )
  }
}
