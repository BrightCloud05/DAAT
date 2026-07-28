/**
 * vault-index.ts
 *
 * SQLite-backed vault index: notes, wikilinks, tags, frontmatter, and an
 * FTS5 full-text table. Lives in userData/vault-index/<vault-id>.db — NEVER
 * inside the vault folder (SQLite inside an iCloud-synced dir risks
 * corruption and pollutes the user's vault with machine-local state).
 *
 * Wikilink resolution: targets match note filenames (sans extension) or
 * titles, NFC-normalized and case-folded — APFS/iCloud round-trip filenames
 * through NFD, so byte-equality is the wrong comparison.
 *
 * The Python agent plugin (M3) opens this same DB read-only for its
 * vault_backlinks tool; keep schema changes backward-readable.
 */

import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

import type { VaultLink, VaultNote, VaultSearchHit } from './vault-types'
import type { ParsedNote } from './vault-parser'

export const SNIPPET_START = ''
export const SNIPPET_END = ''

const SCHEMA_VERSION = 1

function linkKey(raw: string): string {
  // "Note Name#heading" targets the note; strip the heading fragment.
  const base = raw.split('#')[0].trim()

  return base.normalize('NFC').toLowerCase()
}

function noteKeys(relPath: string, title: string): { pathKey: string; nameKey: string; titleKey: string } {
  const name = path.posix.basename(relPath).replace(/\.(md|markdown)$/i, '')

  return {
    pathKey: relPath.replace(/\.(md|markdown)$/i, '').normalize('NFC').toLowerCase(),
    nameKey: name.normalize('NFC').toLowerCase(),
    titleKey: title.normalize('NFC').toLowerCase()
  }
}

export class VaultIndex {
  private db: Database.Database

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.migrate()
  }

  private migrate(): void {
    const version = this.db.pragma('user_version', { simple: true }) as number

    if (version >= SCHEMA_VERSION) {
      return
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        path TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        mtime_ms REAL NOT NULL,
        size INTEGER NOT NULL,
        hash TEXT NOT NULL,
        dataless INTEGER NOT NULL DEFAULT 0,
        path_key TEXT NOT NULL,
        name_key TEXT NOT NULL,
        title_key TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notes_name_key ON notes(name_key);
      CREATE INDEX IF NOT EXISTS idx_notes_title_key ON notes(title_key);

      CREATE TABLE IF NOT EXISTS links (
        source TEXT NOT NULL,
        target_raw TEXT NOT NULL,
        target_key TEXT NOT NULL,
        line INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_links_source ON links(source);
      CREATE INDEX IF NOT EXISTS idx_links_target_key ON links(target_key);

      CREATE TABLE IF NOT EXISTS tags (
        path TEXT NOT NULL,
        tag TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
      CREATE INDEX IF NOT EXISTS idx_tags_path ON tags(path);

      CREATE TABLE IF NOT EXISTS frontmatter (
        path TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_frontmatter_path ON frontmatter(path);

      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        path UNINDEXED,
        title,
        body,
        tokenize = 'unicode61 remove_diacritics 2'
      );

      PRAGMA user_version = ${SCHEMA_VERSION};
    `)
  }

  upsertNote(
    relPath: string,
    parsed: ParsedNote,
    meta: { mtimeMs: number; size: number; hash: string; dataless: boolean }
  ): void {
    const keys = noteKeys(relPath, parsed.title)

    const run = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO notes (path, title, mtime_ms, size, hash, dataless, path_key, name_key, title_key)
           VALUES (@path, @title, @mtimeMs, @size, @hash, @dataless, @pathKey, @nameKey, @titleKey)
           ON CONFLICT(path) DO UPDATE SET
             title=@title, mtime_ms=@mtimeMs, size=@size, hash=@hash, dataless=@dataless,
             path_key=@pathKey, name_key=@nameKey, title_key=@titleKey`
        )
        .run({
          path: relPath,
          title: parsed.title,
          mtimeMs: meta.mtimeMs,
          size: meta.size,
          hash: meta.hash,
          dataless: meta.dataless ? 1 : 0,
          ...keys
        })

      this.db.prepare('DELETE FROM links WHERE source = ?').run(relPath)
      this.db.prepare('DELETE FROM tags WHERE path = ?').run(relPath)
      this.db.prepare('DELETE FROM frontmatter WHERE path = ?').run(relPath)
      this.db.prepare('DELETE FROM notes_fts WHERE path = ?').run(relPath)

      const insertLink = this.db.prepare(
        'INSERT INTO links (source, target_raw, target_key, line) VALUES (?, ?, ?, ?)'
      )

      for (const link of parsed.links) {
        insertLink.run(relPath, link.targetRaw, linkKey(link.targetRaw), link.line)
      }

      const insertTag = this.db.prepare('INSERT INTO tags (path, tag) VALUES (?, ?)')

      for (const tag of parsed.tags) {
        insertTag.run(relPath, tag)
      }

      const insertFm = this.db.prepare('INSERT INTO frontmatter (path, key, value) VALUES (?, ?, ?)')

      for (const [key, value] of Object.entries(parsed.frontmatter)) {
        insertFm.run(relPath, key, typeof value === 'string' ? value : JSON.stringify(value))
      }

      this.db
        .prepare('INSERT INTO notes_fts (path, title, body) VALUES (?, ?, ?)')
        .run(relPath, parsed.title, parsed.plainText)
    })

    run()
  }

  removeNote(relPath: string): void {
    const run = this.db.transaction(() => {
      this.db.prepare('DELETE FROM notes WHERE path = ?').run(relPath)
      this.db.prepare('DELETE FROM links WHERE source = ?').run(relPath)
      this.db.prepare('DELETE FROM tags WHERE path = ?').run(relPath)
      this.db.prepare('DELETE FROM frontmatter WHERE path = ?').run(relPath)
      this.db.prepare('DELETE FROM notes_fts WHERE path = ?').run(relPath)
    })

    run()
  }

  renameNote(fromPath: string, toPath: string): void {
    // Content is unchanged; the watcher re-parses the new path anyway. Just
    // drop the old rows so a slow re-parse never leaves a ghost entry.
    this.removeNote(fromPath)
  }

  getNote(relPath: string): { hash: string; mtimeMs: number } | null {
    const row = this.db.prepare('SELECT hash, mtime_ms as mtimeMs FROM notes WHERE path = ?').get(relPath) as
      | { hash: string; mtimeMs: number }
      | undefined

    return row ?? null
  }

  noteCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM notes').get() as { count: number }

    return row.count
  }

  listNotes(): VaultNote[] {
    const rows = this.db
      .prepare('SELECT path, title, mtime_ms as mtimeMs, size, dataless FROM notes ORDER BY path')
      .all() as Array<{ path: string; title: string; mtimeMs: number; size: number; dataless: number }>

    return rows.map(row => ({ ...row, dataless: Boolean(row.dataless) }))
  }

  /** All note base-names + titles, for wikilink autocomplete in the editor. */
  noteNames(): Array<{ path: string; title: string; name: string }> {
    return this.db
      .prepare(
        `SELECT path, title, name_key as name FROM notes ORDER BY mtime_ms DESC`
      )
      .all() as Array<{ path: string; title: string; name: string }>
  }

  resolveWikilink(targetRaw: string): string | null {
    const key = linkKey(targetRaw)

    if (!key) {
      return null
    }

    const byPath = this.db.prepare('SELECT path FROM notes WHERE path_key = ?').get(key) as
      | { path: string }
      | undefined

    if (byPath) {
      return byPath.path
    }

    const byName = this.db
      .prepare('SELECT path FROM notes WHERE name_key = ? ORDER BY length(path) LIMIT 1')
      .get(key) as { path: string } | undefined

    if (byName) {
      return byName.path
    }

    const byTitle = this.db
      .prepare('SELECT path FROM notes WHERE title_key = ? ORDER BY length(path) LIMIT 1')
      .get(key) as { path: string } | undefined

    return byTitle?.path ?? null
  }

  /** Notes that link TO the given note (resolved through name/title/path keys). */
  backlinks(relPath: string): VaultLink[] {
    const note = this.db
      .prepare('SELECT path, path_key, name_key, title_key FROM notes WHERE path = ?')
      .get(relPath) as { path: string; path_key: string; name_key: string; title_key: string } | undefined

    if (!note) {
      return []
    }

    const rows = this.db
      .prepare(
        `SELECT source, target_raw as targetRaw, line FROM links
         WHERE target_key IN (?, ?, ?) AND source != ?
         ORDER BY source, line`
      )
      .all(note.path_key, note.name_key, note.title_key, relPath) as Array<{
      source: string
      targetRaw: string
      line: number
    }>

    return rows.map(row => ({ ...row, targetPath: relPath }))
  }

  linksFrom(relPath: string): VaultLink[] {
    const rows = this.db
      .prepare('SELECT source, target_raw as targetRaw, target_key as targetKey, line FROM links WHERE source = ?')
      .all(relPath) as Array<{ source: string; targetRaw: string; targetKey: string; line: number }>

    return rows.map(row => ({
      source: row.source,
      targetRaw: row.targetRaw,
      targetPath: this.resolveWikilink(row.targetRaw),
      line: row.line
    }))
  }

  search(query: string, limit = 50): VaultSearchHit[] {
    const trimmed = query.trim()

    if (!trimmed) {
      return []
    }

    // Quote each term so user input can't break FTS5 query syntax; append *
    // to the last term for as-you-type prefix search.
    const terms = trimmed.split(/\s+/).map(term => `"${term.replace(/"/g, '""')}"`)
    const last = terms.pop()
    const ftsQuery = [...terms, `${last}*`].join(' ')

    try {
      return this.db
        .prepare(
          `SELECT path, title, snippet(notes_fts, 2, ?, ?, '…', 12) as snippet
           FROM notes_fts WHERE notes_fts MATCH ?
           ORDER BY bm25(notes_fts, 0, 2.0, 1.0) LIMIT ?`
        )
        .all(SNIPPET_START, SNIPPET_END, ftsQuery, limit) as VaultSearchHit[]
    } catch {
      return []
    }
  }

  /**
   * Every note with its frontmatter as a property map — the data behind the
   * Notion-style table view. Values were stored as strings (JSON-encoded for
   * non-strings); decode best-effort.
   */
  propertiesTable(): Array<{ path: string; title: string; mtimeMs: number; props: Record<string, unknown> }> {
    const notes = this.db
      .prepare('SELECT path, title, mtime_ms as mtimeMs FROM notes ORDER BY mtime_ms DESC')
      .all() as Array<{ path: string; title: string; mtimeMs: number }>

    const fmRows = this.db.prepare('SELECT path, key, value FROM frontmatter').all() as Array<{
      path: string
      key: string
      value: string | null
    }>

    const byPath = new Map<string, Record<string, unknown>>()

    for (const row of fmRows) {
      let value: unknown = row.value

      if (typeof row.value === 'string') {
        try {
          value = JSON.parse(row.value)
        } catch {
          value = row.value
        }
      }

      const props = byPath.get(row.path) ?? {}

      props[row.key] = value
      byPath.set(row.path, props)
    }

    return notes.map(note => ({ ...note, props: byPath.get(note.path) ?? {} }))
  }

  /** Full wipe — used when (re)indexing a vault from scratch. */
  clear(): void {
    this.db.exec('DELETE FROM notes; DELETE FROM links; DELETE FROM tags; DELETE FROM frontmatter; DELETE FROM notes_fts;')
  }

  close(): void {
    try {
      this.db.close()
    } catch {
      // Already closed — nothing to release.
    }
  }
}
