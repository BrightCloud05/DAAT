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
/** Set when a save failed; the editor keeps the text and retries. */
export const $vaultSaveError = atom<string | null>(null)

let saveTimer: ReturnType<typeof setTimeout> | null = null
let pendingContent: string | null = null
let wired = false

/**
 * Bumped by every note switch. Anything that awaits captures the token first
 * and drops its result if the user has moved on — otherwise a slow read for
 * note A lands after note B opened and silently swaps the document.
 */
let openToken = 0
/** In-flight flush, so two callers await the same write instead of racing. */
let flushInFlight: Promise<void> | null = null
let saveFailures = 0

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

  const token = ++openToken
  const result = await vault().read(relPath)

  if (token !== openToken) {
    return
  }

  $activeNote.set(result)
  $activeDirty.set(false)
  pendingContent = null
}

export async function createNote(relPath: string): Promise<VaultReadResult | null> {
  await flushActiveNote()

  const token = ++openToken
  const result = await vault().createNote(relPath)

  if (token !== openToken) {
    return null
  }

  $activeNote.set(result)
  $activeDirty.set(false)
  pendingContent = null
  await refreshVaultNotes()

  return result
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

export function flushActiveNote(): Promise<void> {
  // Callers await this from note switches, unmount and window close. Without
  // sharing the in-flight promise, the second caller sees pendingContent
  // already null, returns immediately, and proceeds as if the save landed.
  if (flushInFlight) {
    return flushInFlight
  }

  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }

  const active = $activeNote.get()
  const content = pendingContent

  if (!active || content === null) {
    return Promise.resolve()
  }

  const token = openToken

  flushInFlight = (async () => {
    let result: VaultWriteResult

    try {
      result = await vault().write(active.path, content, active.mtimeMs, active.content)
    } catch (error) {
      // The text is still in pendingContent — never drop it. Retry with
      // backoff and tell the user, rather than failing silently forever.
      saveFailures++
      $vaultSaveError.set(error instanceof Error ? error.message : String(error))
      saveTimer = setTimeout(() => void flushActiveNote(), Math.min(30_000, 1000 * 2 ** saveFailures))

      return
    }

    saveFailures = 0
    $vaultSaveError.set(null)

    // The user may have switched notes while the write was in flight; the
    // result belongs to the note we started with, not whatever is open now.
    if (token !== openToken) {
      return
    }

    if (result.ok) {
      $activeNote.set({ ...active, content, mtimeMs: result.mtimeMs })

      // Keystrokes that landed during the write are still unsaved.
      if (pendingContent === content) {
        pendingContent = null
        $activeDirty.set(false)
      }
    } else {
      // Conflict: our content went to a conflict copy; reload what's on disk so
      // the editor shows disk truth, and surface the conflict for the UI.
      const fresh = await vault().read(active.path)

      if (token === openToken) {
        $activeNote.set(fresh)
        pendingContent = null
        $activeDirty.set(false)
      }
    }
  })().finally(() => {
    flushInFlight = null

    // A keystroke arrived mid-write: re-arm so it still reaches disk.
    if (pendingContent !== null && !saveTimer) {
      saveTimer = setTimeout(() => void flushActiveNote(), 1000)
    }
  })

  return flushInFlight
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
        const token = openToken

        void vault()
          .read(active.path)
          .then(fresh => {
            const current = $activeNote.get()

            // Most of these events are the watcher echoing our own save.
            // Re-setting an identical note would churn the editor for nothing.
            if (
              token === openToken &&
              current &&
              current.path === fresh.path &&
              current.content !== fresh.content &&
              !$activeDirty.get()
            ) {
              $activeNote.set(fresh)
            }
          })
          .catch(() => undefined)
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
