/**
 * Shared vault-todos cache: one scan feeds the Home widget, the sidebar
 * count, and the future Todo screen. Refreshes when the vault notes change.
 */

import { atom } from 'nanostores'

import { $vaultNotes } from '../vault/store'

export interface VaultTodo {
  path: string
  line: number
  text: string
  done: boolean
}

export const $vaultTodos = atom<VaultTodo[]>([])

let wired = false
let inFlight = false

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
  $vaultNotes.subscribe(() => void refreshTodos())
}

export async function toggleTodo(todo: VaultTodo): Promise<void> {
  const ok = await window.hermesDesktop.vault.toggleTodo(todo.path, todo.line)

  if (ok) {
    $vaultTodos.set(
      $vaultTodos.get().map(item =>
        item.path === todo.path && item.line === todo.line ? { ...item, done: !item.done } : item
      )
    )
  }
}
