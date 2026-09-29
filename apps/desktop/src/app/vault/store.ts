/**
 * Vault renderer state. Nanostores atoms (matching src/store/* conventions)
 * over the `hermesDesktop.vault` preload bridge. The main process owns truth
 * (index + files); this store is a thin cache the index-event stream keeps
 * fresh.
 */

import { atom } from 'nanostores'

import { setVaultRoot } from '@/store/vault-root'

const vault = () => window.hermesDesktop.vault

export const $vaultInfo = atom<VaultInfo | null>(null)

// Publish the root down into the store layer, where the session machinery can
// read it without importing app code. See store/vault-root.ts for why the
// agent's working directory matters beyond path resolution.
$vaultInfo.subscribe(info => setVaultRoot(info?.root ?? ''))
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
 * Shown while a save waits on iCloud to finish downloading the note it would
 * overwrite. Not really an error — the text is safe in the buffer and the
 * retry loop is running — but the user has to know why the dot is still amber.
 */
export const ICLOUD_DOWNLOAD_PENDING = 'Waiting for iCloud to finish downloading this note.'

/**
 * Text that could not be saved, kept by note path.
 *
 * Every switch away from a note drops `pendingContent` — it has to, or the old
 * note's text follows the user into the new note's file. But the drain before
 * it is allowed to fail (read-only volume, unplugged drive, a note iCloud has
 * not finished sending), and then dropping the buffer was dropping writing the
 * user had done and never saw saved. There was no message: the dirty dot moved
 * on with the new note.
 *
 * So the buffer is parked here instead. Reopening the note puts it back in the
 * editor, marked unsaved, and the ordinary save path takes it from there.
 */
const rescued = new Map<string, string>()
const recoveryEntries = new Map<string, VaultRecoveryEntry>()
const journalWrites = new Map<string, Promise<void>>()

function persistRecovery(entry: VaultRecoveryEntry): Promise<void> {
  const current = journalWrites.get(entry.id)

  if (current) {
    return current
  }

  const writing = (async () => {
    let snapshot: VaultRecoveryEntry | undefined = entry

    while (snapshot) {
      await vault().saveRecovery(snapshot)
      const latest = recoveryEntries.get(snapshot.path)
      snapshot = latest?.id === snapshot.id && latest !== snapshot ? latest : undefined
    }
  })().finally(() => journalWrites.delete(entry.id))

  journalWrites.set(entry.id, writing)

  return writing
}

/** Paths holding text that never reached disk. The UI has to say so. */
export const $vaultRescued = atom<string[]>([])

function publishRescued(): void {
  $vaultRescued.set([...rescued.keys()])
}

function rescue(relPath: string, content: string, base = $activeNote.get()): void {
  rescued.set(relPath, content)
  const root = base?.vaultRoot ?? $vaultInfo.get()?.root

  if (root && base) {
    const previous = recoveryEntries.get(relPath)

    const entry: VaultRecoveryEntry = {
      id: previous?.id ?? crypto.randomUUID(),
      vaultRoot: root,
      path: relPath,
      content,
      baseContent: previous?.baseContent ?? base.content,
      mtimeMs: previous?.mtimeMs ?? base.mtimeMs,
      updatedAt: Date.now()
    }

    recoveryEntries.set(relPath, entry)
    void persistRecovery(entry).catch(error => {
      $vaultSaveError.set(`Could not preserve the recovery copy: ${String(error)}`)
    })
  }

  publishRescued()
}

function releaseRescue(relPath: string): void {
  const entry = recoveryEntries.get(relPath)
  recoveryEntries.delete(relPath)

  if (entry) {
    void (journalWrites.get(entry.id) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => vault().removeRecovery(entry.id))
      .catch(error => $vaultSaveError.set(`Could not remove an old recovery copy: ${String(error)}`))
  }

  if (rescued.delete(relPath)) {
    publishRescued()
  }
}

export async function restoreRecovery(root: string): Promise<void> {
  const entries = await vault().listRecovery(root)

  if ($vaultInfo.get()?.root !== root) {
    return
  }

  for (const entry of entries) {
    const previous = recoveryEntries.get(entry.path)

    if (previous && previous.id !== entry.id) {
      const recoveredPath = previous.path.replace(/(\.[^.]+)?$/, ` (recovered ${previous.id.slice(-8)})$1`)
      const displaced = { ...previous, path: recoveredPath }
      recoveryEntries.set(recoveredPath, displaced)
      rescued.set(recoveredPath, previous.content)
      void persistRecovery(displaced).catch(() => undefined)
    }

    recoveryEntries.set(entry.path, entry)
    rescued.set(entry.path, entry.content)
  }

  publishRescued()
}

/** Close/reload only after the edits reached the note or the recovery journal. */
export async function prepareVaultForClose(): Promise<void> {
  await drainPendingWrites()
  parkPending()
  await Promise.all([...recoveryEntries.values()].map(entry => persistRecovery(entry)))

  if (pendingContent !== null && !recoveryEntries.has($activeNote.get()?.path ?? '')) {
    throw new Error('The note could not be saved or preserved. Keep this window open and retry.')
  }
}

/** The unsaved text held for a note, if any. The editor seeds its doc from it. */
export function rescuedText(relPath: string): string | undefined {
  return rescued.get(relPath)
}

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
 * Drop every buffered edit and stop the retry loop.
 *
 * Used when switching vaults — a pending edit must never follow the user into
 * a different vault — and to give tests a clean slate. It discards text on
 * purpose, so callers that could still save should flush first.
 */
export function resetSaveState(): void {
  clearSaveTimer()
  pendingContent = null
  // A full reset, including across a vault switch: the parked paths belong to
  // the vault being left and mean nothing in the next one.
  rescued.clear()
  recoveryEntries.clear()
  publishRescued()
  flushInFlight = null
  saveFailures = 0
  openToken++
  $activeDirty.set(false)
  $vaultSaveError.set(null)
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
  await prepareVaultForClose()
  const info = await vault().create(baseDir)
  // Edits can arrive while the main process changes roots. Their saved root
  // remains the old vault, so preserve them before clearing renderer state.
  parkPending()
  await Promise.all([...recoveryEntries.values()].map(entry => persistRecovery(entry)))
  resetSaveState()
  $activeNote.set(null)
  $vaultInfo.set(info)

  if (info.root) {
    await restoreRecovery(info.root)
  }

  await refreshVaultNotes()
}

export async function chooseVault(): Promise<void> {
  const selected = await vault().selectFolder()

  if (selected) {
    await prepareVaultForClose()
    const info = await vault().open(selected)
    parkPending()
    await Promise.all([...recoveryEntries.values()].map(entry => persistRecovery(entry)))
    resetSaveState()
    $activeNote.set(null)
    $vaultInfo.set(info)

    if (info.root) {
      await restoreRecovery(info.root)
    }

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

/**
 * Hold onto text the drain could not get to disk, under the note it belongs
 * to. Called at every point that is about to drop `pendingContent`.
 */
function parkPending(): void {
  const active = $activeNote.get()

  if (pendingContent !== null && active) {
    rescue(active.path, pendingContent)
  }
}

export async function openNote(relPath: string): Promise<void> {
  const root = $vaultInfo.get()?.root ?? undefined
  await drainPendingWrites()

  const token = ++openToken

  // Nothing from the previous note may survive into the read below — but a
  // failed drain leaves real writing here, and dropping it is losing it.
  parkPending()
  clearSaveTimer()
  pendingContent = null

  const held = recoveryEntries.get(relPath)

  const result = await vault()
    .read(relPath, root)
    .catch(error => {
      if (!held) {
        throw error
      }

      return {
        path: relPath,
        vaultRoot: held.vaultRoot,
        content: held.baseContent,
        mtimeMs: held.mtimeMs,
        dataless: false
      }
    })

  adoptNote(held ? { ...result, content: held.baseContent, mtimeMs: held.mtimeMs } : result, token)
}

export async function createNote(relPath: string): Promise<(VaultReadResult & { created: boolean }) | null> {
  const root = $vaultInfo.get()?.root ?? undefined
  await drainPendingWrites()

  const token = ++openToken

  parkPending()
  clearSaveTimer()
  pendingContent = null

  const result = await vault().createNote(relPath, root)

  if (token !== openToken) {
    return null
  }

  const held = recoveryEntries.get(result.path)
  adoptNote(held ? { ...result, content: held.baseContent, mtimeMs: held.mtimeMs } : result, token)
  await refreshVaultNotes()

  return result
}

/**
 * Move a note to the OS trash.
 *
 * The pending-autosave state for the note must be dropped BEFORE the trash
 * call: writeNote() skips every conflict guard when the file is gone, so a
 * debounced autosave landing after the trash would silently recreate it.
 */
export async function deleteNote(relPath: string): Promise<void> {
  const active = $activeNote.get()
  const root = $vaultInfo.get()?.root ?? undefined
  await drainPendingWrites()
  await vault().trash(relPath, root)

  if (active?.path === relPath) {
    clearSaveTimer()
    pendingContent = null
    openToken++
    $activeDirty.set(false)
    $activeNote.set(null)
  }

  // Rescued text for a note the user chose to delete is meaningless now.
  releaseRescue(relPath)
  await refreshVaultNotes()
}

/** Rename (move) a note; the open editor follows it to the new path. */
export async function renameNote(fromRel: string, toRel: string): Promise<void> {
  const root = $vaultInfo.get()?.root ?? undefined
  await drainPendingWrites()

  if (pendingContent !== null) {
    throw new Error('Save this note before renaming it.')
  }

  await vault().rename(fromRel, toRel, root)
  await refreshVaultNotes()

  if ($activeNote.get()?.path === fromRel) {
    await openNote(toRel)
  }
}

/** Editor calls this on every doc change; the actual write is debounced 1s. */
export function noteEdited(content: string): void {
  const active = $activeNote.get()

  if (!active || content === active.content) {
    if (pendingContent !== null && content === $activeNote.get()?.content) {
      // An in-flight write can still change disk away from this text. Queue
      // the revert after it, instead of treating the old disk snapshot as saved.
      pendingContent = flushInFlight ? content : null
      $activeDirty.set(Boolean(flushInFlight))

      if (active) {
        if (flushInFlight) {
          rescue(active.path, content, active)
        } else {
          releaseRescue(active.path)
        }
      }
    }

    return
  }

  pendingContent = content
  $activeDirty.set(true)
  rescue(active.path, content, active)

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
      result = await vault().write(
        active.path,
        content,
        active.mtimeMs,
        active.content,
        active.vaultRoot ?? $vaultInfo.get()?.root ?? undefined
      )
    } catch (error) {
      // The text is still in pendingContent — never drop it. Retry with
      // backoff and tell the user, rather than failing silently forever.
      saveFailures++
      rescue(active.path, pendingContent ?? content, active)
      $vaultSaveError.set(error instanceof Error ? error.message : String(error))
      saveTimer = setTimeout(() => void flushActiveNote(), Math.min(30_000, 1000 * 2 ** saveFailures))

      return
    }

    if (!result.ok && result.reason === 'unreadable') {
      // The note's text is still coming down from iCloud, so the write was
      // refused rather than run against bytes nobody has seen. Treat it like
      // any other transient failure: keep pendingContent, back off, retry.
      // It resolves itself once the download lands.
      saveFailures++
      rescue(active.path, pendingContent ?? content, active)
      $vaultSaveError.set(ICLOUD_DOWNLOAD_PENDING)
      saveTimer = setTimeout(() => void flushActiveNote(), Math.min(30_000, 1000 * 2 ** saveFailures))

      return
    }

    saveFailures = 0

    // It reached disk — as the note itself, or as a conflict copy beside it.
    // Either way there is nothing left to hold.
    if (pendingContent === content) {
      releaseRescue(active.path)
    }

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
        const fresh = await vault().read(active.path, active.vaultRoot)

        if (pendingContent !== null && pendingContent !== content) {
          // The conflict copy contains only the submitted snapshot. Keep
          // later keystrokes in the editor and durable journal for the retry.
          rescue(active.path, pendingContent, active)
          $vaultSaveError.set(
            'The note changed elsewhere. Your latest edits are preserved and will be saved as a conflict copy.'
          )
        } else {
          adoptNote(fresh, token)
        }
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

  void refreshVaultInfo()
    .then(async () => {
      const root = $vaultInfo.get()?.root

      if (root) {
        await restoreRecovery(root)
      }

      await refreshVaultNotes()
    })
    .catch(error => $vaultSaveError.set(String(error)))
  window.hermesDesktop.onBeforeClose?.(prepareVaultForClose)

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

      if (event.type === 'note-changed' && active && event.path === active.path && !$activeDirty.get()) {
        const token = openToken

        void vault()
          .read(active.path, active.vaultRoot)
          .then(fresh => {
            const current = $activeNote.get()

            // Most of these events are the watcher echoing our own save.
            // Re-setting an identical note would churn the editor for nothing.
            //
            // `!fresh.dataless` guards the other direction: an evicted read
            // comes back as empty content, and adopting it would blank the
            // open note on screen. Keep showing what we have and wait for the
            // download — the same event fires again with the real text.
            if (
              token === openToken &&
              current &&
              current.path === fresh.path &&
              current.content !== fresh.content &&
              !fresh.dataless &&
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

/**
 * A free "Untitled.md" name for a new page. Lives here rather than in the
 * sidebar because the empty editor offers the same action, and two copies of
 * a uniqueness rule is one copy too many.
 */
export function newUntitledPath(notes: VaultNote[]): string {
  const existing = new Set(notes.map(note => note.path))
  let name = 'Untitled.md'

  for (let index = 2; existing.has(name); index++) {
    name = `Untitled ${index}.md`
  }

  return name
}
