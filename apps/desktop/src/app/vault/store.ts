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
/**
 * Coarse "the vault changed" counter for panels that run an IPC query.
 *
 * $vaultNotes gets a fresh array on every index event, so using it as an
 * effect dependency re-queried the index on every autosave. This bumps at
 * most a few times a second and only when something actually landed.
 */
export const $vaultRevision = atom(0)

let revisionTimer: ReturnType<typeof setTimeout> | null = null

function bumpVaultRevision(): void {
  if (revisionTimer) {
    return
  }

  revisionTimer = setTimeout(() => {
    revisionTimer = null
    $vaultRevision.set($vaultRevision.get() + 1)
  }, 500)
}

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

function clearSaveTimer(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
}

/**
 * Flush until nothing is pending.
 *
 * A single `flushActiveNote()` can return the promise of a write that started
 * BEFORE the newest keystrokes, so awaiting it once and concluding "saved"
 * dropped whatever arrived in between. Bounded, because a genuinely failing
 * write (read-only volume, offline iCloud) would otherwise spin forever; the
 * retry timer keeps trying in the background either way.
 */
/**
 * Drop every buffered edit and stop the retry loop.
 *
 * Used when switching vaults — a pending edit must never follow the user into
 * a different vault — and to give tests a clean slate. It discards text on
 * purpose, so callers that could still save should flush first.
 */
export function resetSaveState(): void {
  clearSaveTimer()
  pendingContent = null
  flushInFlight = null
  saveFailures = 0
  openToken++
  $activeDirty.set(false)
  $vaultSaveError.set(null)
}

async function drainPendingWrites(attempts = 4): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    await flushActiveNote()

    if (pendingContent === null) {
      return
    }
  }
}

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
  await drainPendingWrites()
  resetSaveState()
  $activeNote.set(null)
  $vaultInfo.set(await vault().create(baseDir))
  await refreshVaultNotes()
}

export async function chooseVault(): Promise<void> {
  const info = await vault().choose()

  if (info) {
    // Save into the OLD vault before the root changes, then drop anything
    // still buffered — a pending edit must not follow the user across vaults.
    await drainPendingWrites()
    resetSaveState()
    $activeNote.set(null)
    $vaultInfo.set(info)
    await refreshVaultNotes()
  }
}

/**
 * Hand the active note over to a different one.
 *
 * Order matters and is not cosmetic: `$activeNote.set()` notifies subscribers
 * SYNCHRONOUSLY, and one of them (inline AI) calls back into flushActiveNote.
 * If `pendingContent` still held the OLD note's text at that moment, that text
 * was written into the NEW note's file — with the new note's mtime and
 * content as the conflict guard, so every safety check passed and the write
 * succeeded. Clear the pending state BEFORE publishing the new note.
 */
function adoptNote(result: VaultReadResult, token: number): void {
  if (token !== openToken) {
    return
  }

  clearSaveTimer()
  pendingContent = null
  $activeDirty.set(false)
  $activeNote.set(result)
}

export async function openNote(relPath: string): Promise<void> {
  await drainPendingWrites()

  const token = ++openToken

  // Nothing from the previous note may survive into the read below.
  clearSaveTimer()
  pendingContent = null

  adoptNote(await vault().read(relPath), token)
}

export async function createNote(relPath: string): Promise<(VaultReadResult & { created: boolean }) | null> {
  await drainPendingWrites()

  const token = ++openToken

  clearSaveTimer()
  pendingContent = null

  const result = await vault().createNote(relPath)

  if (token !== openToken) {
    return null
  }

  adoptNote(result, token)
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

  // Before the early return above, not after: a debounce that fired during an
  // in-flight write left a stale handle here, and the re-arm below checks
  // `!saveTimer` — so autosave silently stopped until the next keystroke.
  clearSaveTimer()

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
      // Record what is now on disk (the next write compares against it), but
      // leave `$activeDirty` set when newer keystrokes arrived mid-write —
      // the editor uses that flag to know its own text is ahead of the store
      // and must not be replaced.
      if (pendingContent === content) {
        pendingContent = null
        $activeDirty.set(false)
      }

      $activeNote.set({ ...active, content, mtimeMs: result.mtimeMs })
    } else {
      // Conflict: our content went to a conflict copy; reload what's on disk so
      // the editor shows disk truth, and surface the conflict for the UI.
      try {
        const fresh = await vault().read(active.path)

        adoptNote(fresh, token)
      } catch {
        // The note vanished under us. Keep the buffer rather than throwing out
        // of the shared promise, which every `void flushActiveNote()` caller
        // would surface as an unhandled rejection.
        $vaultSaveError.set(`Could not reload ${active.path} after a conflict.`)
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

let searchTimer: ReturnType<typeof setTimeout> | null = null
let searchToken = 0

/**
 * Run a vault search, debounced.
 *
 * The query is FTS5 in the main process — synchronous, and a one-character
 * query becomes a prefix match over the entire corpus. Firing that on every
 * keystroke froze the whole app (all windows, all IPC) while the user typed.
 */
export function runVaultSearch(query: string): void {
  $vaultSearch.set(query)

  if (searchTimer) {
    clearTimeout(searchTimer)
    searchTimer = null
  }

  if (!query.trim()) {
    searchToken++
    $vaultSearchHits.set([])

    return
  }

  const token = ++searchToken

  searchTimer = setTimeout(async () => {
    try {
      const hits = await vault().search(query)

      // A slower earlier query must not overwrite a newer one's results.
      if (token === searchToken) {
        $vaultSearchHits.set(hits)
      }
    } catch {
      if (token === searchToken) {
        $vaultSearchHits.set([])
      }
    }
  }, 180)
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
      bumpVaultRevision()
      void refreshVaultInfo()
      void refreshVaultNotes()
    } else {
      bumpVaultRevision()
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
  // beforeunload cannot await, so by the time it runs the write may not
  // finish. Flushing whenever the user leaves the window means the buffer is
  // almost always already empty when they quit — and closing a laptop lid or
  // switching apps is exactly when people stop typing.
  window.addEventListener('blur', () => void flushActiveNote())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void flushActiveNote()
    }
  })
  window.addEventListener('beforeunload', () => {
    void flushActiveNote()
  })
}
