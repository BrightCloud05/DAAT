/**
 * vault-service.ts
 *
 * The vault orchestrator: owns which vault is open, its SQLite index, and the
 * folder watcher. One vault open at a time (v1). The open vault persists in
 * userData/vault.json (same pattern as project-dir.json) so relaunch restores
 * it without prompting.
 *
 * Index DB lives in userData/vault-index/<vault-id>.db where vault-id is a
 * hash of the vault's real path — NEVER inside the vault (iCloud sync would
 * corrupt SQLite and pollute the user's notes folder).
 */

import { app } from 'electron'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import {
  contentHash,
  icloudPlaceholderTarget,
  isMarkdownFile,
  readNote,
  resolveInVault,
  toVaultRelative,
  writeNote
} from './vault-fs'
import { VaultIndex } from './vault-index'
import { parseNote } from './vault-parser'
import type { VaultWatcher, VaultWatcherEvent } from './vault-watcher'
import { watchVault } from './vault-watcher'
import type {
  VaultConflictEvent,
  VaultEntry,
  VaultIndexEvent,
  VaultInfo,
  VaultLink,
  VaultNote,
  VaultReadResult,
  VaultSearchHit,
  VaultWriteResult
} from './vault-types'

const VAULT_CONFIG_FILENAME = 'vault.json'
/** Yield to the event loop every N notes during a full index. */
const INDEX_YIELD_EVERY = 20

export interface VaultServiceEvents {
  onIndexEvent(event: VaultIndexEvent): void
  onConflict(event: VaultConflictEvent): void
}

function vaultConfigPath(): string {
  return path.join(app.getPath('userData'), VAULT_CONFIG_FILENAME)
}

function vaultId(root: string): string {
  let real = root

  try {
    real = fs.realpathSync(root)
  } catch {
    // Missing dir — hash the given path; open() will fail loudly anyway.
  }

  return createHash('sha1').update(real).digest('hex').slice(0, 16)
}

function isICloudPath(root: string): boolean {
  return root.includes(path.join('Library', 'Mobile Documents'))
}

export function defaultICloudVaultDir(): string | null {
  if (process.platform !== 'darwin') {
    return null
  }

  const cloudDocs = path.join(app.getPath('home'), 'Library', 'Mobile Documents', 'com~apple~CloudDocs')

  try {
    if (!fs.statSync(cloudDocs).isDirectory()) {
      return null
    }
  } catch {
    return null
  }

  return path.join(cloudDocs, 'BISEO', 'Notes')
}

export function defaultLocalVaultDir(): string {
  return path.join(app.getPath('documents'), 'BISEO', 'Notes')
}

const WELCOME_NOTE = `# Welcome to your vault

This folder is yours: plain markdown files on disk. Edit them here, in any
other editor, or let the agent work on them with you.

- Link notes with [[wikilinks]] — type \`[[\` in the editor
- Type \`/\` on an empty line for blocks: headings, callouts, tables…
- Organize with folders, or don't — search finds everything
- Tag with #topics anywhere in a note
`

/** Starter templates seeded into <vault>/Templates on create — plain notes
 *  the user can edit; {{date}} and {{title}} substitute on use. */
const STARTER_TEMPLATES: Record<string, string> = {
  'Daily.md': `---
date: {{date}}
---

## Today

- [ ]

## Notes

`,
  'Meeting Notes.md': `---
date: {{date}}
attendees: []
status: draft
---

## Agenda

-

## Decisions

> [!note] Key decision
>

## Action items

- [ ]
`,
  'Project.md': `---
status: planning
owner:
due:
tags: [project]
---

## Goal

## Plan

- [ ]

## Log

`
}

export class VaultService {
  private root: string | null = null
  private index: VaultIndex | null = null
  private watcher: VaultWatcher | null = null
  private indexing = false
  private events: VaultServiceEvents

  constructor(events: VaultServiceEvents) {
    this.events = events
  }

  // -- lifecycle ------------------------------------------------------------

  async restore(): Promise<void> {
    try {
      const raw = await fsp.readFile(vaultConfigPath(), 'utf8')
      const parsed = JSON.parse(raw)

      if (parsed && typeof parsed.root === 'string' && fs.statSync(parsed.root).isDirectory()) {
        await this.open(parsed.root)
      }
    } catch {
      // No saved vault / vanished dir — the renderer offers create/choose.
    }
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(vaultConfigPath()), { recursive: true })
      fs.writeFileSync(vaultConfigPath(), JSON.stringify({ root: this.root }, null, 2), 'utf8')
    } catch {
      // Non-fatal: vault just won't restore on next launch.
    }
  }

  async open(root: string): Promise<VaultInfo> {
    const resolved = path.resolve(root)
    const stat = await fsp.stat(resolved)

    if (!stat.isDirectory()) {
      throw new Error(`Not a directory: ${resolved}`)
    }

    const home = app.getPath('home')
    const forbidden = [app.getPath('userData'), path.join(home, '.biseo'), path.join(home, '.hermes')]

    if (resolved === home || forbidden.some(dir => resolved === dir || resolved.startsWith(dir + path.sep))) {
      throw new Error(`This folder can't be used as a vault: ${resolved}`)
    }

    await this.close()

    this.root = resolved
    this.index = new VaultIndex(path.join(app.getPath('userData'), 'vault-index', `${vaultId(resolved)}.db`))
    this.watcher = await watchVault(resolved, events => void this.handleWatcherEvents(events))
    this.persist()
    void this.reindex()

    return this.info()
  }

  async create(baseDir?: string): Promise<VaultInfo> {
    const target = baseDir || defaultICloudVaultDir() || defaultLocalVaultDir()

    await fsp.mkdir(target, { recursive: true })

    const welcomePath = path.join(target, 'Welcome.md')

    try {
      await fsp.access(welcomePath)
    } catch {
      await writeNote(welcomePath, WELCOME_NOTE, null)
    }

    // Seed starter templates (skip any the user already has).
    for (const [name, content] of Object.entries(STARTER_TEMPLATES)) {
      const templatePath = path.join(target, 'Templates', name)

      try {
        await fsp.access(templatePath)
      } catch {
        await writeNote(templatePath, content, null)
      }
    }

    return this.open(target)
  }

  async close(): Promise<void> {
    await this.watcher?.close()
    this.watcher = null
    this.index?.close()
    this.index = null
    this.root = null
  }

  info(): VaultInfo {
    if (!this.root || !this.index) {
      return { root: null, name: null, noteCount: 0, location: null, indexing: false }
    }

    return {
      root: this.root,
      name: path.basename(path.dirname(this.root)) === 'BISEO' ? 'BISEO' : path.basename(this.root),
      noteCount: this.index.noteCount(),
      location: isICloudPath(this.root) ? 'icloud' : 'local',
      indexing: this.indexing
    }
  }

  // -- indexing -------------------------------------------------------------

  private requireOpen(): { root: string; index: VaultIndex } {
    if (!this.root || !this.index) {
      throw new Error('No vault is open')
    }

    return { root: this.root, index: this.index }
  }

  private async scanMarkdownFiles(root: string): Promise<string[]> {
    const results: string[] = []
    const queue: string[] = [root]

    while (queue.length) {
      const dir = queue.pop()!

      let entries: fs.Dirent[]

      try {
        entries = await fsp.readdir(dir, { withFileTypes: true })
      } catch {
        continue
      }

      for (const entry of entries) {
        if (entry.name.startsWith('.') && !icloudPlaceholderTarget(entry.name)) {
          continue
        }

        const absolute = path.join(dir, entry.name)

        if (entry.isDirectory()) {
          queue.push(absolute)
          continue
        }

        const placeholder = icloudPlaceholderTarget(entry.name)
        const effective = placeholder ? path.join(dir, placeholder) : absolute

        if (isMarkdownFile(effective)) {
          results.push(toVaultRelative(root, effective))
        }
      }
    }

    return [...new Set(results)].sort()
  }

  async reindex(): Promise<void> {
    const { root, index } = this.requireOpen()

    if (this.indexing) {
      return
    }

    this.indexing = true

    try {
      const files = await this.scanMarkdownFiles(root)
      const known = new Set(files)

      // Drop rows for notes that no longer exist on disk.
      for (const note of index.listNotes()) {
        if (!known.has(note.path)) {
          index.removeNote(note.path)
        }
      }

      let indexed = 0

      for (const relPath of files) {
        await this.indexOne(relPath, { skipUnchanged: true })
        indexed += 1

        if (indexed % INDEX_YIELD_EVERY === 0) {
          this.events.onIndexEvent({ type: 'index-progress', indexed, total: files.length })
          await new Promise(resolve => setImmediate(resolve))
        }
      }

      this.events.onIndexEvent({ type: 'index-complete', noteCount: index.noteCount() })
    } finally {
      this.indexing = false
    }
  }

  private async indexOne(relPath: string, opts: { skipUnchanged?: boolean } = {}): Promise<void> {
    const { root, index } = this.requireOpen()
    const absolute = resolveInVault(root, relPath)

    let stat: fs.Stats

    try {
      stat = await fsp.stat(absolute)
    } catch {
      index.removeNote(relPath)

      return
    }

    if (opts.skipUnchanged) {
      const existing = index.getNote(relPath)

      if (existing && Math.abs(existing.mtimeMs - stat.mtimeMs) < 1) {
        return
      }
    }

    const { content, dataless } = await readNote(absolute)
    const hash = contentHash(content)

    if (opts.skipUnchanged) {
      const existing = index.getNote(relPath)

      if (existing && existing.hash === hash && !dataless) {
        return
      }
    }

    const fallbackTitle = path.posix.basename(relPath).replace(/\.(md|markdown)$/i, '')
    const parsed = dataless
      ? { title: fallbackTitle, links: [], tags: [], headings: [], frontmatter: {}, plainText: '' }
      : parseNote(content, fallbackTitle)

    index.upsertNote(relPath, parsed, { mtimeMs: stat.mtimeMs, size: stat.size, hash, dataless })
  }

  private async handleWatcherEvents(events: VaultWatcherEvent[]): Promise<void> {
    const { index } = this.requireOpen()

    for (const event of events) {
      if (event.type === 'deleted') {
        index.removeNote(event.relPath)
        this.events.onIndexEvent({ type: 'note-removed', path: event.relPath })
      } else {
        await this.indexOne(event.relPath, { skipUnchanged: true })
        this.events.onIndexEvent({ type: 'note-changed', path: event.relPath })
      }
    }
  }

  // -- note operations (all take/return vault-relative paths) ---------------

  list(): VaultNote[] {
    return this.requireOpen().index.listNotes()
  }

  async listDir(subdir = ''): Promise<VaultEntry[]> {
    const { root } = this.requireOpen()
    const absolute = resolveInVault(root, subdir || '.')
    const entries = await fsp.readdir(absolute, { withFileTypes: true })
    const results: VaultEntry[] = []
    const seen = new Set<string>()

    for (const entry of entries) {
      const placeholder = icloudPlaceholderTarget(entry.name)
      const name = placeholder ?? entry.name

      if (name.startsWith('.') || seen.has(name)) {
        continue
      }

      seen.add(name)

      const relPath = path.posix.join(subdir, name)

      results.push({
        path: relPath,
        name,
        kind: entry.isDirectory() ? 'dir' : isMarkdownFile(name) ? 'note' : 'file',
        dataless: Boolean(placeholder)
      })
    }

    return results.sort((a, b) => {
      if (a.kind === 'dir' && b.kind !== 'dir') return -1
      if (a.kind !== 'dir' && b.kind === 'dir') return 1

      return a.name.localeCompare(b.name)
    })
  }

  async read(relPath: string): Promise<VaultReadResult> {
    const { root } = this.requireOpen()
    const result = await readNote(resolveInVault(root, relPath))

    return { path: relPath, ...result }
  }

  async write(relPath: string, content: string, expectedMtimeMs: number | null): Promise<VaultWriteResult> {
    const { root } = this.requireOpen()
    const absolute = resolveInVault(root, relPath)
    const result = await writeNote(absolute, content, expectedMtimeMs)

    if (!result.ok && result.conflictPath) {
      const conflictRel = toVaultRelative(root, result.conflictPath)

      this.events.onConflict({ path: relPath, conflictPath: conflictRel })
      void this.indexOne(conflictRel)

      return { ok: false, reason: 'conflict', conflictPath: conflictRel }
    }

    void this.indexOne(relPath)

    return { ok: true, mtimeMs: result.mtimeMs }
  }

  async createNote(relPath: string): Promise<VaultReadResult> {
    const { root } = this.requireOpen()
    const withExt = isMarkdownFile(relPath) ? relPath : `${relPath}.md`
    const absolute = resolveInVault(root, withExt)

    try {
      await fsp.access(absolute)
    } catch {
      const title = path.posix.basename(withExt).replace(/\.(md|markdown)$/i, '')

      await writeNote(absolute, `# ${title}\n\n`, null)
      await this.indexOne(withExt)
    }

    return this.read(withExt)
  }

  async createDir(relPath: string): Promise<void> {
    const { root } = this.requireOpen()

    await fsp.mkdir(resolveInVault(root, relPath), { recursive: true })
  }

  async rename(fromRel: string, toRel: string): Promise<void> {
    const { root, index } = this.requireOpen()
    const from = resolveInVault(root, fromRel)
    const to = resolveInVault(root, toRel)

    await fsp.mkdir(path.dirname(to), { recursive: true })
    await fsp.rename(from, to)
    index.renameNote(fromRel, toRel)

    if (isMarkdownFile(toRel)) {
      await this.indexOne(toRel)
    } else {
      // Renamed a folder: contained notes all moved — cheapest correct answer
      // is a background reindex (hash-skip makes it fast).
      void this.reindex()
    }

    this.events.onIndexEvent({ type: 'vault-changed' })
  }

  async trash(relPath: string): Promise<void> {
    const { root, index } = this.requireOpen()
    const absolute = resolveInVault(root, relPath)
    const { shell } = await import('electron')

    await shell.trashItem(absolute)
    index.removeNote(relPath)
    this.events.onIndexEvent({ type: 'note-removed', path: relPath })
  }

  search(query: string): VaultSearchHit[] {
    return this.requireOpen().index.search(query)
  }

  backlinks(relPath: string): VaultLink[] {
    return this.requireOpen().index.backlinks(relPath)
  }

  linksFrom(relPath: string): VaultLink[] {
    return this.requireOpen().index.linksFrom(relPath)
  }

  resolveWikilink(targetRaw: string): string | null {
    return this.requireOpen().index.resolveWikilink(targetRaw)
  }

  noteNames(): Array<{ path: string; title: string; name: string }> {
    return this.requireOpen().index.noteNames()
  }

  propertiesTable(): Array<{ path: string; title: string; mtimeMs: number; props: Record<string, unknown> }> {
    return this.requireOpen().index.propertiesTable()
  }

  indexDbPath(): string | null {
    return this.root
      ? path.join(app.getPath('userData'), 'vault-index', `${vaultId(this.root)}.db`)
      : null
  }
}
