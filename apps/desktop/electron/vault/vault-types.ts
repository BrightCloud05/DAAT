/**
 * vault-types.ts
 *
 * Shared shapes for the vault subsystem. Imported by the main-process vault
 * services and mirrored (structurally) by the renderer's `hermesDesktop.vault`
 * typings in src/global.d.ts — keep the two in sync when this changes.
 */

/** A note row as the index knows it. Paths are vault-relative, POSIX-style. */
export interface VaultNote {
  path: string
  title: string
  mtimeMs: number
  size: number
  /** Content is not local (iCloud-evicted placeholder or FileProvider dataless). */
  dataless: boolean
}

export interface VaultLink {
  /** Vault-relative path of the note containing the link. */
  source: string
  /** Raw wikilink target as written, e.g. "Note Name" from [[Note Name|label]]. */
  targetRaw: string
  /** Resolved vault-relative path, or null when the target doesn't exist yet. */
  targetPath: string | null
  line: number
}

export interface VaultSearchHit {
  path: string
  title: string
  /** FTS5 snippet with match markers (see SNIPPET_START/END in vault-index). */
  snippet: string
}

export interface VaultInfo {
  /** Absolute path of the open vault root, or null when no vault is open. */
  root: string | null
  name: string | null
  noteCount: number
  /** Where the vault lives: iCloud Drive, plain local disk, or nothing open. */
  location: 'icloud' | 'local' | null
  indexing: boolean
}

export interface VaultEntry {
  /** Vault-relative POSIX path. */
  path: string
  name: string
  kind: 'dir' | 'note' | 'file'
  dataless: boolean
}

export interface VaultReadResult {
  path: string
  content: string
  /** mtime observed at read time — hand back to write() for conflict detection. */
  mtimeMs: number
  dataless: boolean
}

export type VaultWriteResult =
  | { ok: true; mtimeMs: number }
  | {
      /** The file changed on disk after our read — content was NOT written. */
      ok: false
      reason: 'conflict'
      /** Where the caller's content was preserved instead. */
      conflictPath: string
    }

/** Pushed to the renderer over `hermes:vault:index-event`. */
export type VaultIndexEvent =
  | { type: 'index-progress'; indexed: number; total: number }
  | { type: 'index-complete'; noteCount: number }
  | { type: 'note-changed'; path: string }
  | { type: 'note-removed'; path: string }
  | { type: 'vault-changed' }

export interface VaultConflictEvent {
  path: string
  conflictPath: string
}

/** One note in the link graph. `degree` is how many edges touch it. */
export interface VaultGraphNode {
  path: string
  title: string
  degree: number
}

export interface VaultGraphEdge {
  source: string
  target: string
}

export interface VaultGraph {
  nodes: VaultGraphNode[]
  edges: VaultGraphEdge[]
}
