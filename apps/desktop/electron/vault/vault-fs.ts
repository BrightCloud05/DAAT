/**
 * vault-fs.ts
 *
 * Filesystem primitives for the vault, hardened for iCloud Drive:
 *
 *  - Writes are atomic (temp file + rename in the same directory) so a sync
 *    engine never observes a half-written note.
 *  - Writes verify the on-disk mtime against the mtime the caller read at —
 *    a mismatch means the file changed underneath us (remote edit landed);
 *    instead of clobbering it we divert the caller's content to a visible
 *    conflict copy and report it.
 *  - Reads tolerate FileProvider "dataless" files: content was evicted by
 *    "Optimize Mac Storage" and open() blocks while iCloud re-downloads.
 *    We race the read against a timeout and escalate to `brctl download`.
 *  - Legacy `.name.md.icloud` placeholder plists are surfaced as the real
 *    note name with `dataless: true` instead of leaking into listings.
 *
 * Pure Node (no Electron imports) so it stays unit-testable.
 */

import { execFile } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

const DATALESS_READ_TIMEOUT_MS = 4_000
const BRCTL_DOWNLOAD_TIMEOUT_MS = 60_000

const ICLOUD_PLACEHOLDER_RE = /^\.(.+)\.icloud$/

/** `.Note.md.icloud` → `Note.md`, anything else → null. */
export function icloudPlaceholderTarget(name: string): string | null {
  const match = ICLOUD_PLACEHOLDER_RE.exec(name)

  return match ? match[1] : null
}

export function isMarkdownFile(name: string): boolean {
  return /\.(md|markdown)$/i.test(name)
}

export function contentHash(content: string | Buffer): string {
  return createHash('sha1').update(content).digest('hex')
}

/**
 * Resolve a vault-relative path against the vault root, refusing anything
 * that escapes the root (`..`, absolute paths, symlink-free lexical check).
 * Callers treat a throw as a hard programming/input error.
 */
export function resolveInVault(root: string, relPath: string): string {
  const cleaned = relPath.replace(/\\/g, '/').replace(/^\/+/, '')
  const absolute = path.resolve(root, cleaned)
  const rootResolved = path.resolve(root)

  if (absolute !== rootResolved && !absolute.startsWith(rootResolved + path.sep)) {
    throw new Error(`Path escapes vault root: ${relPath}`)
  }

  return absolute
}

export function toVaultRelative(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join('/')
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)

    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/** Ask iCloud to materialize an evicted file (macOS only; no-op elsewhere). */
export function requestICloudDownload(absolutePath: string): Promise<void> {
  if (process.platform !== 'darwin') {
    return Promise.resolve()
  }

  return new Promise(resolve => {
    const child = execFile('brctl', ['download', absolutePath], () => resolve())

    setTimeout(() => {
      child.kill()
      resolve()
    }, BRCTL_DOWNLOAD_TIMEOUT_MS).unref?.()
  })
}

export interface ReadNoteResult {
  content: string
  mtimeMs: number
  dataless: boolean
}

/**
 * Read a note, tolerating iCloud eviction. First attempt races a timeout;
 * on timeout we fire `brctl download` and retry once with a long deadline.
 * A read that still fails surfaces `dataless: true` with empty content so
 * the UI can show a "downloading from iCloud" state instead of an error.
 */
export async function readNote(absolutePath: string): Promise<ReadNoteResult> {
  const attempt = async () => {
    const [content, stat] = await Promise.all([fsp.readFile(absolutePath, 'utf8'), fsp.stat(absolutePath)])

    return { content, mtimeMs: stat.mtimeMs, dataless: false }
  }

  try {
    return await withTimeout(attempt(), DATALESS_READ_TIMEOUT_MS, `read ${path.basename(absolutePath)}`)
  } catch {
    await requestICloudDownload(absolutePath)

    try {
      return await withTimeout(attempt(), BRCTL_DOWNLOAD_TIMEOUT_MS, `download ${path.basename(absolutePath)}`)
    } catch {
      let mtimeMs = 0

      try {
        mtimeMs = (await fsp.stat(absolutePath)).mtimeMs
      } catch {
        // stat also failing means the file is gone — report as dataless anyway;
        // the watcher will remove it from the index if it was deleted.
      }

      return { content: '', mtimeMs, dataless: true }
    }
  }
}

function conflictCopyPath(absolutePath: string): string {
  const dir = path.dirname(absolutePath)
  const ext = path.extname(absolutePath)
  const base = path.basename(absolutePath, ext)
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}`

  return path.join(dir, `${base} (conflict ${stamp})${ext}`)
}

async function atomicWrite(absolutePath: string, content: string): Promise<number> {
  const dir = path.dirname(absolutePath)
  const tmp = path.join(dir, `.${path.basename(absolutePath)}.tmp-${randomBytes(4).toString('hex')}`)

  await fsp.mkdir(dir, { recursive: true })
  await fsp.writeFile(tmp, content, 'utf8')

  try {
    await fsp.rename(tmp, absolutePath)
  } catch (error) {
    await fsp.rm(tmp, { force: true })
    throw error
  }

  return (await fsp.stat(absolutePath)).mtimeMs
}

export interface WriteNoteResult {
  ok: boolean
  mtimeMs: number
  conflictPath?: string
}

/**
 * Write a note atomically. `expectedMtimeMs` is the mtime from the caller's
 * last read; if the file on disk has moved past it (remote/concurrent edit),
 * the caller's content goes to a conflict copy and the on-disk file is left
 * alone. `expectedMtimeMs === null` means "new file or overwrite knowingly".
 *
 * Unchanged content is never rewritten — sync engines treat every write as a
 * new version, so no-op saves would churn iCloud for nothing.
 */
export async function writeNote(
  absolutePath: string,
  content: string,
  expectedMtimeMs: number | null
): Promise<WriteNoteResult> {
  let existing: fs.Stats | null = null

  try {
    existing = await fsp.stat(absolutePath)
  } catch {
    existing = null
  }

  if (existing && expectedMtimeMs !== null && Math.abs(existing.mtimeMs - expectedMtimeMs) > 1) {
    const current = await fsp.readFile(absolutePath, 'utf8').catch(() => null)

    if (current !== null && current === content) {
      return { ok: true, mtimeMs: existing.mtimeMs }
    }

    const conflictPath = conflictCopyPath(absolutePath)
    const mtimeMs = await atomicWrite(conflictPath, content)

    return { ok: false, mtimeMs, conflictPath }
  }

  if (existing) {
    const current = await fsp.readFile(absolutePath, 'utf8').catch(() => null)

    if (current !== null && current === content) {
      return { ok: true, mtimeMs: existing.mtimeMs }
    }
  }

  const mtimeMs = await atomicWrite(absolutePath, content)

  return { ok: true, mtimeMs }
}
