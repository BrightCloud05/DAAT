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

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { app } from 'electron'

import {
  contentHash,
  hasICloudPlaceholder,
  icloudPlaceholderTarget,
  isMarkdownFile,
  moveWithoutOverwrite,
  readNote,
  resolveInVault,
  toVaultRelative,
  writeNote
} from './vault-fs'
import { VaultIndex } from './vault-index'
import { parseNote } from './vault-parser'
import { VaultRecovery } from './vault-recovery'
import type {
  VaultConflictEvent,
  VaultEntry,
  VaultGraph,
  VaultIndexEvent,
  VaultInfo,
  VaultLink,
  VaultNote,
  VaultReadResult,
  VaultRecoveryEntry,
  VaultSearchHit,
  VaultWriteResult
} from './vault-types'
import type { VaultWatcher, VaultWatcherEvent } from './vault-watcher'
import { watchVault } from './vault-watcher'

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

  return path.join(cloudDocs, 'Daat', 'Notes')
}

export function defaultLocalVaultDir(): string {
  return path.join(app.getPath('documents'), 'Daat', 'Notes')
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
  /** Bumped on every open/close; in-flight index runs compare against it. */
  private openEpoch = 0
  private indexingEpoch = -1
  private events: VaultServiceEvents
  private recovery = new VaultRecovery(path.join(app.getPath('userData'), 'vault-recovery'))

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
    const resolved = await fsp.realpath(root)
    const stat = await fsp.stat(resolved)

    if (!stat.isDirectory()) {
      throw new Error(`Not a directory: ${resolved}`)
    }

    // Reject the folder BEFORE writing anything into it. Seeding first meant
    // picking $HOME by mistake littered it with Templates/*.md and only then
    // raised the error.
    const home = app.getPath('home')
    const forbidden = [app.getPath('userData'), path.join(home, '.daat'), path.join(home, '.hermes')]

    if (resolved === home || forbidden.some(dir => resolved === dir || resolved.startsWith(dir + path.sep))) {
      throw new Error(`This folder can't be used as a vault: ${resolved}`)
    }

    // Vaults created before templates shipped get the starters on open —
    // skip-existing, and only when the folder is absent entirely so a user
    // who deleted it stays deleted... (folder present = user's call).
    try {
      await fsp.access(path.join(resolved, 'Templates'))
    } catch {
      for (const [name, content] of Object.entries(STARTER_TEMPLATES)) {
        await writeNote(path.join(resolved, 'Templates', name), content, null).catch(() => undefined)
      }
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
    // Invalidate any in-flight index run before the handles go away.
    this.openEpoch += 1
    this.indexing = false

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
      name: path.basename(path.dirname(this.root)) === 'Daat' ? 'Daat' : path.basename(this.root),
      noteCount: this.index.noteCount(),
      location: isICloudPath(this.root) ? 'icloud' : 'local',
      indexing: this.indexing
    }
  }

  // -- indexing -------------------------------------------------------------

  private requireOpen(expectedRoot?: string): { root: string; index: VaultIndex } {
    if (!this.root || !this.index) {
      throw new Error('No vault is open')
    }

    if (expectedRoot && path.resolve(expectedRoot) !== this.root) {
      throw new Error('The vault changed. This operation still belongs to the previous vault.')
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

  /**
   * Rebuild the index for the currently open vault.
   *
   * The loop yields between notes, so a vault switch can land mid-run. Each
   * run is stamped with the open epoch: an orphaned run stops instead of
   * writing into a closed SQLite handle, and — the part that actually broke
   * things — it no longer holds `indexing` true and starve the new vault's
   * reindex, which used to leave the freshly opened vault showing zero notes.
   */
  async reindex(): Promise<void> {
    const { root, index } = this.requireOpen()
    const epoch = this.openEpoch

    if (this.indexing && this.indexingEpoch === epoch) {
      return
    }

    this.indexing = true
    this.indexingEpoch = epoch

    try {
      const files = await this.scanMarkdownFiles(root)

      if (this.openEpoch !== epoch) {
        return
      }

      const known = new Set(files)

      // Drop rows for notes that no longer exist on disk.
      for (const note of index.listNotes()) {
        if (!known.has(note.path)) {
          index.removeNote(note.path)
        }
      }

      let indexed = 0

      for (const relPath of files) {
        if (this.openEpoch !== epoch) {
          return
        }

        try {
          await this.indexOne(relPath, { skipUnchanged: true })
        } catch {
          // One unreadable/unparseable note must not abort the whole index.
        }

        indexed += 1

        if (indexed % INDEX_YIELD_EVERY === 0) {
          this.events.onIndexEvent({ type: 'index-progress', indexed, total: files.length })
          await new Promise(resolve => setImmediate(resolve))
        }
      }

      if (this.openEpoch === epoch) {
        this.events.onIndexEvent({ type: 'index-complete', noteCount: index.noteCount() })
      }
    } finally {
      if (this.openEpoch === epoch) {
        this.indexing = false
      }
    }
  }

  private async indexOne(relPath: string, opts: { skipUnchanged?: boolean } = {}): Promise<void> {
    const { root, index } = this.requireOpen()
    const epoch = this.openEpoch
    const absolute = resolveInVault(root, relPath)

    let stat: fs.Stats

    try {
      stat = await fsp.stat(absolute)
    } catch {
      /*
       * Absent under its own name is not the same as gone.
       *
       * The legacy eviction form replaces `Note.md` with `.Note.md.icloud`, and
       * everything else in the vault already knows that: scanMarkdownFiles maps
       * the placeholder back to the real name, listDir reports the note as
       * present-but-dataless, and writeNote refuses to clobber it. Only this
       * catch treated it as a deletion — so the note vanished from search, the
       * tree and the graph the moment iCloud reclaimed its bytes, and the
       * watcher event announcing the placeholder deleted it again.
       */
      const placeholder = path.join(path.dirname(absolute), `.${path.basename(absolute)}.icloud`)

      try {
        const stub = await fsp.stat(placeholder)
        const title = path.posix.basename(relPath).replace(/\.(md|markdown)$/i, '')

        if (this.openEpoch !== epoch) {
          return
        }

        index.upsertNote(
          relPath,
          { title, links: [], tags: [], headings: [], frontmatter: {}, plainText: '' },
          { mtimeMs: stub.mtimeMs, size: 0, hash: contentHash(''), dataless: true }
        )
      } catch {
        // Neither the note nor a placeholder for it. Now it is gone.
        if (this.openEpoch === epoch) {
          index.removeNote(relPath)
        }
      }

      return
    }

    if (this.openEpoch !== epoch) {
      return
    }

    if (opts.skipUnchanged) {
      const existing = index.getNote(relPath)

      // `!existing.dataless`: a note indexed while its contents were still in
      // iCloud holds an empty body, and materializing it does not change the
      // mtime — so this fast path skipped it on every reindex afterwards and
      // the note stayed permanently unsearchable. A dataless row always falls
      // through to the read below.
      if (existing && !existing.dataless && Math.abs(existing.mtimeMs - stat.mtimeMs) < 1) {
        return
      }
    }

    const { content, dataless } = await readNote(absolute)
    const hash = contentHash(content)

    if (this.openEpoch !== epoch) {
      return
    }

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

    index.upsertNote(relPath, parsed, { mtimeMs: stat.mtimeMs, size: stat.size, hash, dataless, content })
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

    let entries: fs.Dirent[]

    try {
      entries = await fsp.readdir(absolute, { withFileTypes: true })
    } catch {
      // Missing subfolder (e.g. Templates before it exists) is an empty
      // listing, not an error worth surfacing.
      return []
    }

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
      if (a.kind === 'dir' && b.kind !== 'dir') {
        return -1
      }

      if (a.kind !== 'dir' && b.kind === 'dir') {
        return 1
      }

      return a.name.localeCompare(b.name)
    })
  }

  async read(relPath: string, expectedRoot?: string): Promise<VaultReadResult> {
    const { root } = this.requireOpen(expectedRoot)
    const result = await readNote(resolveInVault(root, relPath))

    return { path: relPath, vaultRoot: root, ...result }
  }

  async write(
    relPath: string,
    content: string,
    expectedMtimeMs: number | null,
    expectedContent?: string,
    expectedRoot?: string
  ): Promise<VaultWriteResult> {
    const { root } = this.requireOpen(expectedRoot)
    const absolute = resolveInVault(root, relPath)
    const result = await writeNote(absolute, content, expectedMtimeMs, expectedContent)

    if (result.unreadable) {
      // Do not index: nothing changed on disk, and re-indexing an evicted note
      // would just record it as empty.
      return { ok: false, reason: 'unreadable' }
    }

    if (!result.ok && result.conflictPath) {
      const conflictRel = toVaultRelative(root, result.conflictPath)

      if (this.root === root) {
        this.events.onConflict({ path: relPath, conflictPath: conflictRel })
        void this.indexOne(conflictRel).catch(() => undefined)
      }

      return { ok: false, reason: 'conflict', conflictPath: conflictRel }
    }

    if (this.root === root) {
      void this.indexOne(relPath).catch(() => undefined)
    }

    return { ok: true, mtimeMs: result.mtimeMs }
  }

  async createNote(relPath: string, expectedRoot?: string): Promise<VaultReadResult & { created: boolean }> {
    const { root } = this.requireOpen(expectedRoot)
    const withExt = isMarkdownFile(relPath) ? relPath : `${relPath}.md`
    const absolute = resolveInVault(root, withExt)

    let created = false

    try {
      await fsp.access(absolute)
    } catch {
      if (await hasICloudPlaceholder(absolute)) {
        return { ...(await this.read(withExt, root)), created: false }
      }

      const title = path.posix.basename(withExt).replace(/\.(md|markdown)$/i, '')
      await fsp.mkdir(path.dirname(absolute), { recursive: true })

      try {
        const handle = await fsp.open(absolute, 'wx')

        try {
          await handle.writeFile(`# ${title}\n\n`, 'utf8')
          await handle.sync()
        } finally {
          await handle.close()
        }

        created = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw error
        }
      }

      if (this.root === root) {
        await this.indexOne(withExt)
      }
    }

    return { ...(await this.read(withExt, root)), created }
  }

  /**
   * Write raw bytes into the vault (meeting recordings).
   *
   * Separate from write(): that path is markdown-only — it round-trips through
   * a string, compares content and can divert to a conflict copy, none of
   * which is meaningful for an opaque audio blob.
   */
  async writeBinary(
    relPath: string,
    data: Uint8Array,
    expectedRoot?: string
  ): Promise<{ path: string; bytes: number }> {
    const { root } = this.requireOpen(expectedRoot)
    const absolute = resolveInVault(root, relPath)

    await fsp.mkdir(path.dirname(absolute), { recursive: true })
    await fsp.writeFile(absolute, data)

    return { path: relPath, bytes: data.byteLength }
  }

  /**
   * Append bytes to a file, creating it if needed.
   *
   * The recorder needs this: a meeting lives in renderer memory until stop(),
   * so quitting or losing the microphone mid-meeting threw the whole thing
   * away. Appending each 5s chunk as it arrives makes the timeslice actually
   * durable — what has been captured is on disk, always.
   *
   * Deliberately not the atomic temp+rename that notes use: rewriting a
   * gigabyte-scale recording every five seconds would be its own bug, and a
   * truncated final chunk still leaves a playable file.
   */
  async appendBinary(
    relPath: string,
    data: Uint8Array,
    expectedRoot?: string
  ): Promise<{ path: string; bytes: number }> {
    const { root } = this.requireOpen(expectedRoot)
    const absolute = resolveInVault(root, relPath)

    await fsp.mkdir(path.dirname(absolute), { recursive: true })
    await fsp.appendFile(absolute, data)

    return { path: relPath, bytes: (await fsp.stat(absolute)).size }
  }

  async createDir(relPath: string, expectedRoot?: string): Promise<void> {
    const { root } = this.requireOpen(expectedRoot)

    await fsp.mkdir(resolveInVault(root, relPath), { recursive: true })
  }

  async rename(fromRel: string, toRel: string, expectedRoot?: string): Promise<void> {
    const { root, index } = this.requireOpen(expectedRoot)
    const from = resolveInVault(root, fromRel)
    const to = resolveInVault(root, toRel)

    await fsp.mkdir(path.dirname(to), { recursive: true })
    await moveWithoutOverwrite(from, to)

    if (this.root !== root) {
      return
    }

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

  async trash(relPath: string, expectedRoot?: string): Promise<void> {
    const { root, index } = this.requireOpen(expectedRoot)
    const absolute = resolveInVault(root, relPath)
    const { shell } = await import('electron')

    await shell.trashItem(absolute)

    if (this.root !== root) {
      return
    }

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

  linkGraph(): VaultGraph {
    return this.requireOpen().index.linkGraph()
  }

  propertiesTable(): Array<{ path: string; title: string; mtimeMs: number; props: Record<string, unknown> }> {
    return this.requireOpen().index.propertiesTable()
  }

  /**
   * Checkbox tasks across the vault (`- [ ]` / `- [x]`), most-recent notes
   * first, capped for dashboard use. Line scan over real files — the FTS
   * index strips markers, and honest data beats a fast lie.
   */
  async todos(limit?: number): Promise<Array<{ path: string; line: number; text: string; done: boolean }>> {
    return this.requireOpen().index.todos(limit)
  }

  /**
   * Flip a checkbox task found by todos() — safe line edit via write().
   *
   * `expectedText` is what the user actually clicked. Line numbers come from a
   * todos() snapshot that goes stale on every edit, so without this an insert
   * above the task silently flips a *different* checkbox. When the line has
   * moved we re-find the task by its text instead of trusting the number.
   */
  async toggleTodo(relPath: string, lineNo: number, expectedText?: string, expectedRoot?: string): Promise<boolean> {
    const { root } = this.requireOpen(expectedRoot)
    const absolute = resolveInVault(root, relPath)
    const { content, mtimeMs, dataless } = await readNote(absolute)

    if (dataless) {
      return false
    }

    const lines = content.split('\n')
    const textOf = (value: string | undefined) => /^\s*[-*]\s+\[[ xX]\]\s+(.+)$/.exec(value ?? '')?.[1]?.trim()

    if (expectedText && textOf(lines[lineNo - 1]) !== expectedText) {
      // Search outward from where the caller thought it was. Taking the first
      // match in the file would flip a different task with the same wording
      // ("Follow up" appears in every meeting note).
      let found = -1

      for (let offset = 1; offset < lines.length && found === -1; offset++) {
        for (const candidate of [lineNo - 1 - offset, lineNo - 1 + offset]) {
          if (candidate >= 0 && candidate < lines.length && textOf(lines[candidate]) === expectedText) {
            found = candidate

            break
          }
        }
      }

      if (found === -1) {
        return false
      }

      lineNo = found + 1
    }

    const line = lines[lineNo - 1]

    if (!line) {
      return false
    }

    const toggled = line.replace(
      /^(\s*[-*]\s+\[)([ xX])(\])/,
      (_all, pre, mark, post) => `${pre}${mark === ' ' ? 'x' : ' '}${post}`
    )

    if (toggled === line) {
      return false
    }

    lines[lineNo - 1] = toggled

    const result = await writeNote(absolute, lines.join('\n'), mtimeMs, content)

    if (result.ok && this.root === root) {
      void this.indexOne(relPath)
    }

    return result.ok
  }

  saveRecovery(entry: VaultRecoveryEntry): Promise<void> {
    return this.recovery.save(entry)
  }
  listRecovery(root: string): Promise<VaultRecoveryEntry[]> {
    return this.recovery.list(root)
  }
  removeRecovery(id: string): Promise<void> {
    return this.recovery.remove(id)
  }

  indexDbPath(): string | null {
    return this.root ? path.join(app.getPath('userData'), 'vault-index', `${vaultId(this.root)}.db`) : null
  }
}
