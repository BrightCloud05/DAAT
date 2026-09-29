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
 * that escapes the root through traversal or an existing symlink.
 * Callers treat a throw as a hard programming/input error.
 */
export function resolveInVault(root: string, relPath: string): string {
  const cleaned = relPath.replace(/\\/g, '/').replace(/^\/+/, '')
  const absolute = path.resolve(root, cleaned)
  const rootResolved = path.resolve(root)

  if (absolute !== rootResolved && !absolute.startsWith(rootResolved + path.sep)) {
    throw new Error(`Path escapes vault root: ${relPath}`)
  }

  const realRoot = fs.realpathSync(rootResolved)
  // A missing file still has an existing ancestor. Check that ancestor too:
  // a linked directory can otherwise turn a new note into an outside write.
  let ancestor = absolute

  while (!fs.existsSync(ancestor)) {
    // A dangling symlink is not a safe missing path.
    try {
      if (fs.lstatSync(ancestor).isSymbolicLink()) {
        throw new Error(`Path escapes vault root: ${relPath}`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }

    ancestor = path.dirname(ancestor)
  }

  const realAncestor = fs.realpathSync(ancestor)

  if (realAncestor !== realRoot && !realAncestor.startsWith(realRoot + path.sep)) {
    throw new Error(`Path escapes vault root: ${relPath}`)
  }

  return absolute
}

/** Move without replacing an existing destination, including concurrent creates. */
export async function moveWithoutOverwrite(from: string, to: string): Promise<void> {
  if (from === to) {
    return
  }

  if (to.startsWith(from + path.sep)) {
    throw new Error('A folder cannot be moved inside itself.')
  }

  const source = await fsp.lstat(from)

  const target = await fsp.lstat(to).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') {
      throw error
    }

    return null
  })

  if (target) {
    if (from.toLowerCase() === to.toLowerCase() && source.ino === target.ino && source.dev === target.dev) {
      await fsp.rename(from, to)

      return
    }

    throw new Error(`A file or folder already exists at ${path.basename(to)}.`)
  }

  await fsp.mkdir(path.dirname(to), { recursive: true })

  if (!source.isDirectory()) {
    await fsp.link(from, to) // atomic no-replace, unlike rename().

    try {
      await fsp.unlink(from)
    } catch (error) {
      await fsp.unlink(to).catch(() => undefined)
      throw error
    }

    return
  }

  // mkdir is an exclusive reservation. Moving each child with the same rule
  // prevents a concurrent destination from replacing any existing file.
  await fsp.mkdir(to)
  const moved: string[] = []

  try {
    for (const name of await fsp.readdir(from)) {
      await moveWithoutOverwrite(path.join(from, name), path.join(to, name))
      moved.push(name)
    }

    await fsp.rmdir(from) // never recursively delete new source-side files.
  } catch (error) {
    for (const name of moved.reverse()) {
      await moveWithoutOverwrite(path.join(to, name), path.join(from, name)).catch(() => undefined)
    }

    await fsp.rmdir(to).catch(() => undefined)
    throw error
  }
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
  } catch (error) {
    // A file that isn't there is not "waiting on iCloud". Reporting it as
    // dataless made callers treat a missing note as one whose contents they
    // must not touch — which is how "create this starter page if it doesn't
    // exist" silently created nothing.
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { content: '', mtimeMs: 0, dataless: await hasICloudPlaceholder(absolutePath) }
    }

    await requestICloudDownload(absolutePath)

    try {
      return await withTimeout(attempt(), BRCTL_DOWNLOAD_TIMEOUT_MS, `download ${path.basename(absolutePath)}`)
    } catch {
      try {
        // Exists but unreadable: genuinely dataless, still syncing down.
        return { content: '', mtimeMs: (await fsp.stat(absolutePath)).mtimeMs, dataless: true }
      } catch {
        // Gone. The watcher will drop it from the index.
        return { content: '', mtimeMs: 0, dataless: false }
      }
    }
  }
}

/**
 * A free name for a conflict copy, to the second and checked for collisions.
 *
 * Both matter. A save loop retrying against a file iCloud keeps touching
 * produces several conflicts inside one minute, and a name that already exists
 * would be overwritten — losing the very writing this branch exists to save.
 */
async function conflictCopyPath(absolutePath: string): Promise<string> {
  const dir = path.dirname(absolutePath)
  const ext = path.extname(absolutePath)
  const base = path.basename(absolutePath, ext)
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const stamp = `${day} ${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`

  for (let n = 0; n < 100; n += 1) {
    const candidate = path.join(dir, `${base} (conflict ${stamp}${n ? ` ${n + 1}` : ''})${ext}`)

    try {
      await fsp.access(candidate)
    } catch {
      return candidate
    }
  }

  return path.join(dir, `${base} (conflict ${stamp} ${randomBytes(3).toString('hex')})${ext}`)
}

async function atomicWrite(absolutePath: string, content: string): Promise<number> {
  const dir = path.dirname(absolutePath)
  const tmp = path.join(dir, `.${path.basename(absolutePath)}.tmp-${randomBytes(4).toString('hex')}`)

  await fsp.mkdir(dir, { recursive: true })

  try {
    // rename() is atomic with respect to the *name*, but the bytes may still be
    // in the page cache. Without the fsync, a crash or power loss between write
    // and flush leaves a note that exists and is empty — the one failure mode a
    // notes app must not have.
    const handle = await fsp.open(tmp, 'w')

    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }

    await fsp.rename(tmp, absolutePath)
  } catch (error) {
    // Every failure path removes the temp file, not just a failed rename. A
    // full disk fails at writeFile, and the leftovers are dot-files nobody
    // sees — but iCloud does, and syncs each one to every device.
    await fsp.rm(tmp, { force: true })
    throw error
  }

  return (await fsp.stat(absolutePath)).mtimeMs
}

/**
 * The legacy eviction form: `Note.md` is absent under its own name and a
 * `.Note.md.icloud` plist stands in its place. The note is real and its text
 * is in iCloud, so a fresh file written at that name is a write against bytes
 * we have never seen.
 */
export async function hasICloudPlaceholder(absolutePath: string): Promise<boolean> {
  const placeholder = path.join(path.dirname(absolutePath), `.${path.basename(absolutePath)}.icloud`)

  try {
    await fsp.stat(placeholder)

    return true
  } catch {
    return false
  }
}

export interface WriteNoteResult {
  ok: boolean
  mtimeMs: number
  /** The caller's content was diverted here; the file on disk is untouched. */
  conflictPath?: string
  /**
   * Nothing was written and nothing was preserved: the file exists but its
   * current bytes could not be read, so there was nothing safe to write
   * against. The caller still holds its text and should retry.
   */
  unreadable?: boolean
}

/**
 * Write a note atomically. `expectedMtimeMs` is the mtime from the caller's
 * last read; if the file on disk has moved past it (remote/concurrent edit),
 * the caller's content goes to a conflict copy and the on-disk file is left
 * alone. `expectedMtimeMs === null` means "new file or overwrite knowingly".
 * `expectedContent`, when given, is the text the caller believes it is
 * replacing — a stronger check than mtime on filesystems with coarse
 * timestamps.
 *
 * Unchanged content is never rewritten — sync engines treat every write as a
 * new version, so no-op saves would churn iCloud for nothing.
 *
 * A file whose current bytes cannot be read is never written over when the
 * caller supplied an expectation: `unreadable` comes back instead, and the
 * caller keeps its text.
 */
const pendingWrites = new Map<string, Promise<WriteNoteResult>>()

export async function writeNote(
  absolutePath: string,
  content: string,
  expectedMtimeMs: number | null,
  expectedContent?: string
): Promise<WriteNoteResult> {
  // Two windows may submit against the same base. Serialize comparison and
  // replacement so the second sees the first writer and creates a copy.
  const key = await fsp.realpath(absolutePath).catch(() => path.resolve(absolutePath))

  const writing = (pendingWrites.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => writeNoteUnlocked(absolutePath, content, expectedMtimeMs, expectedContent))

  pendingWrites.set(key, writing)

  try {
    return await writing
  } finally {
    if (pendingWrites.get(key) === writing) {
      pendingWrites.delete(key)
    }
  }
}

async function writeNoteUnlocked(
  absolutePath: string,
  content: string,
  expectedMtimeMs: number | null,
  expectedContent?: string
): Promise<WriteNoteResult> {
  let existing: fs.Stats | null = null

  try {
    existing = await fsp.stat(absolutePath)
  } catch {
    existing = null
  }

  if (!existing && (await hasICloudPlaceholder(absolutePath))) {
    return { ok: false, mtimeMs: 0, unreadable: true }
  }

  if (existing) {
    // Timed: every other read here is, because open() blocks indefinitely on
    // an iCloud-evicted file. This one runs inside the write IPC on every
    // autosave, so an untimed version would wedge the whole main process.
    const current = await withTimeout(fsp.readFile(absolutePath, 'utf8'), DATALESS_READ_TIMEOUT_MS, 'compare').catch(
      () => null
    )

    // Unchanged content: never rewrite (see the doc comment).
    if (current !== null && current === content) {
      return { ok: true, mtimeMs: existing.mtimeMs }
    }

    if (current === null) {
      /*
       * The file is there but we could not read it — "Optimize Mac Storage"
       * evicted the contents and iCloud has not brought them back yet.
       *
       * Every guard below compares against bytes we do not have, so all of
       * them pass vacuously: the mtime matches (an evicted file still stats
       * fine, and that is the mtime the caller was handed), and the content
       * check has nothing to compare. The write then went through — and what
       * the editor holds for an evicted note is the empty string. That is a
       * note replaced by nothing, in the default iCloud configuration, synced
       * out to every device.
       *
       * A caller that supplied an expectation is editing on top of something
       * it read. Refuse, and let it keep its text and retry.
       */
      if (expectedMtimeMs !== null || expectedContent !== undefined) {
        return { ok: false, mtimeMs: existing.mtimeMs, unreadable: true }
      }
    } else {
      // mtime alone is not enough to detect a concurrent edit: HFS+, SMB and
      // some iCloud paths report whole-second granularity, so an edit landing in
      // the same second as our read is invisible and would be clobbered. When
      // the caller told us what it expected to be replacing, verify the bytes.
      const movedOn =
        expectedMtimeMs !== null &&
        (Math.abs(existing.mtimeMs - expectedMtimeMs) > 1 ||
          (expectedContent !== undefined && current !== expectedContent))

      if (movedOn) {
        const conflictPath = await conflictCopyPath(absolutePath)
        const mtimeMs = await atomicWrite(conflictPath, content)

        return { ok: false, mtimeMs, conflictPath }
      }
    }
  }

  const mtimeMs = await atomicWrite(absolutePath, content)

  return { ok: true, mtimeMs }
}
