/**
 * Vault renderer state. Nanostores atoms (matching src/store/* conventions)
 * over the `hermesDesktop.vault` preload bridge. The main process owns truth
 * (index + files); this store is a thin cache the index-event stream keeps
 * fresh.
 */

import { atom } from 'nanostores'

const vault = () => window.hermesDesktop.vault

export const $vaultInfo = atom<VaultInfo | null>(null)
export const $vaultNotes = atom<VaultNote[]>([])
export const $activeNote = atom<VaultReadResult | null>(null)
export const $activeDirty = atom(false)
export const $vaultSearch = atom('')
export const $vaultSearchHits = atom<VaultSearchHit[]>([])
export const $vaultIndexing = atom<{ indexed: number; total: number } | null>(null)
export const $vaultConflicts = atom<VaultConflictEvent[]>([])

let saveTimer: ReturnType<typeof setTimeout> | null = null
let pendingContent: string | null = null
let wired = false

export async function refreshVaultInfo(): Promise<void> {
  try {
    $vaultInfo.set(await vault().info())
  } catch {
    $vaultInfo.set(null)
  }
}

export async function refreshVaultNotes(): Promise<void> {
  const info = $vaultInfo.get()

  if (!info?.root) {
    $vaultNotes.set([])

    return
  }

  try {
    $vaultNotes.set(await vault().list())
  } catch {
    $vaultNotes.set([])
  }
}

export async function createVault(baseDir?: string): Promise<void> {
  $vaultInfo.set(await vault().create(baseDir))
  await refreshVaultNotes()
}

export async function chooseVault(): Promise<void> {
  const info = await vault().choose()

  if (info) {
    $vaultInfo.set(info)
    await refreshVaultNotes()
  }
}

export async function openNote(relPath: string): Promise<void> {
  await flushActiveNote()

  const result = await vault().read(relPath)

  $activeNote.set(result)
  $activeDirty.set(false)
  pendingContent = null
}

export async function createNote(relPath: string): Promise<void> {
  await flushActiveNote()

  const result = await vault().createNote(relPath)

  $activeNote.set(result)
  $activeDirty.set(false)
  pendingContent = null
  await refreshVaultNotes()
}

/** Editor calls this on every doc change; the actual write is debounced 1s. */
export function noteEdited(content: string): void {
  const active = $activeNote.get()

  if (!active || content === active.content) {
    if (pendingContent !== null && content === $activeNote.get()?.content) {
      pendingContent = null
      $activeDirty.set(false)
    }

    return
  }

  pendingContent = content
  $activeDirty.set(true)

  if (saveTimer) {
    clearTimeout(saveTimer)
  }

  saveTimer = setTimeout(() => void flushActiveNote(), 1000)
}

export async function flushActiveNote(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }

  const active = $activeNote.get()
  const content = pendingContent

  if (!active || content === null) {
    return
  }

  pendingContent = null

  const result = await vault().write(active.path, content, active.mtimeMs)

  if (result.ok) {
    $activeNote.set({ ...active, content, mtimeMs: result.mtimeMs })
    $activeDirty.set(false)
  } else {
    // Conflict: our content went to a conflict copy; reload what's on disk so
    // the editor shows disk truth, and surface the conflict for the UI.
    const fresh = await vault().read(active.path)

    $activeNote.set(fresh)
    $activeDirty.set(false)
  }
}

export async function runVaultSearch(query: string): Promise<void> {
  $vaultSearch.set(query)

  if (!query.trim()) {
    $vaultSearchHits.set([])

    return
  }

  try {
    $vaultSearchHits.set(await vault().search(query))
  } catch {
    $vaultSearchHits.set([])
  }
}

export function dismissConflict(conflictPath: string): void {
  $vaultConflicts.set($vaultConflicts.get().filter(c => c.conflictPath !== conflictPath))
}

/** One-time wiring of push events; called from the contrib module. */
export function initVaultStore(): void {
  if (wired) {
    return
  }

  wired = true

  void refreshVaultInfo().then(refreshVaultNotes)

  vault().onIndexEvent(event => {
    if (event.type === 'index-progress') {
      $vaultIndexing.set({ indexed: event.indexed, total: event.total })
    } else if (event.type === 'index-complete') {
      $vaultIndexing.set(null)
      void refreshVaultInfo()
      void refreshVaultNotes()
    } else {
      void refreshVaultNotes()

      // Another writer (agent, external editor, iCloud sync) touched the open
      // note — refresh the editor unless the user has unsaved edits.
      const active = $activeNote.get()

      if (
        event.type === 'note-changed' &&
        active &&
        event.path === active.path &&
        !$activeDirty.get()
      ) {
        void vault()
          .read(active.path)
          .then(fresh => {
            const current = $activeNote.get()

            if (current && current.path === fresh.path && !$activeDirty.get()) {
              $activeNote.set(fresh)
            }
          })
      }
    }
  })

  vault().onConflict(event => {
    $vaultConflicts.set([...$vaultConflicts.get(), event])
  })

  // Don't lose edits on window close — best-effort flush.
  window.addEventListener('beforeunload', () => {
    void flushActiveNote()
  })
}
