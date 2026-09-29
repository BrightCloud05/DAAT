/**
 * Update bundled agent sources without claiming files added by the user.
 * A staged source swap retains the previous source and environment until the
 * canonical runtime passes validation. Its journal recovers interrupted swaps.
 * User checkouts, changed owned files and incoming path collisions are declined.
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const STAMP_NAME = '.daat-bundle-stamp'

/** Written into the bundle at build time by scripts/stage-agent-source.mjs. */
export const BUNDLE_ID_NAME = '.daat-bundle-id'

/** Directories inside the source tree that are not part of the bundle. */
const NOT_OURS = new Set(['venv', '.venv', '__pycache__', '.git', 'node_modules', '.pytest_cache', '.ruff_cache'])

export interface BundleStamp {
  version: 1 | 2
  /**
   * Fingerprint of the bundle this came from.
   *
   * Not a version string: local builds keep the same version across many
   * changes, and the git build stamp does not move when the tree is dirty. The
   * question being asked is "is the installed source the same as the bundled
   * source", so the answer is taken from the source itself.
   */
  bundle: string
  seededAt: string
  /** Bundle-owned paths, relative and POSIX, to a sha1 of their contents. */
  files: Record<string, string>
}

export type RefreshOutcome =
  | { action: 'seeded'; files: number }
  | { action: 'updated'; files: number; removed: number; from: string; to: string; depsChanged: boolean }
  | { action: 'current' }
  | { action: 'declined'; why: 'git-checkout' | 'no-stamp' | 'locally-modified' | 'path-conflict' | 'runtime-check-required'; detail: string }
  | { action: 'unavailable'; why: string }
  | { action: 'failed'; why: string }

/** Every bundle-owned file under `root`, relative POSIX paths, sorted. */
export function ownedFiles(root: string): string[] {
  const found: string[] = []

  const walk = (dir: string, prefix: string) => {
    let entries: fs.Dirent[]

    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      // The stamp describes the tree, so it cannot be part of what it
      // describes — otherwise writing it changes the fingerprint it just
      // recorded, and every install looks stale one moment after being made.
      if (NOT_OURS.has(entry.name) || entry.name.endsWith('.pyc') || (!prefix && (entry.name === STAMP_NAME || entry.name === BUNDLE_ID_NAME))) {
        continue
      }

      const rel = prefix ? `${prefix}/${entry.name}` : entry.name

      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), rel)
      } else if (entry.isFile()) {
        found.push(rel)
      }
    }
  }

  walk(root, '')

  return found.sort()
}

/**
 * A content hash per file.
 *
 * Size and modification time were the first attempt and they are not good
 * enough for ownership checks: an edit that preserves the length and
 * lands in the same millisecond reads as untouched, and a tool that copies with
 * `-p` preserves both on purpose.
 *
 * Reading the whole tree is affordable because it is not on the common path —
 * see refreshAgentSource, which compares versions first and only gets here when
 * an update is actually waiting.
 */
function describe(root: string, files: string[]): Record<string, string> {
  const out: Record<string, string> = {}

  for (const rel of files) {
    try {
      out[rel] = crypto.createHash('sha1').update(fs.readFileSync(path.join(root, rel))).digest('hex')
    } catch {
      out[rel] = 'missing'
    }
  }

  return out
}

/**
 * Which build a source tree came from.
 *
 * The build computes this over file CONTENTS and writes it into the bundle, so
 * a launch reads one small file instead of walking forty megabytes. That split
 * matters: sizes alone are cheap enough to check on every launch and not exact
 * enough to rely on — a fix that changes `1500` to `9000` leaves every path and
 * every byte count identical, and an update that skipped it would be invisible.
 *
 * Older bundles without an id are hashed once to preserve exact identity.
 */
export function bundleFingerprint(root: string): string {
  try {
    const declared = fs.readFileSync(path.join(root, BUNDLE_ID_NAME), 'utf8').trim()

    if (declared) {
      return declared
    }
  } catch {
    // No id — use exact contents for the older bundle.
  }

  return computeBundleId(root)
}

/** The exact identity, from contents. Used by the build, not by a launch. */
export function computeBundleId(root: string): string {
  const files = describe(root, ownedFiles(root))

  return crypto
    .createHash('sha1')
    .update(Object.entries(files).map(([rel, hash]) => `${rel}:${hash}`).join('\n'))
    .digest('hex')
}

export function readStamp(root: string): BundleStamp | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, STAMP_NAME), 'utf8'))

    return parsed && [1, 2].includes(parsed.version) && typeof parsed.bundle === 'string' &&
      parsed.files && typeof parsed.files === 'object' && !Array.isArray(parsed.files) &&
      Object.entries(parsed.files).every(([rel, hash]) => safeRelativePath(rel) && typeof hash === 'string')
      ? (parsed as BundleStamp) : null
  } catch {
    return null
  }
}

export function writeStamp(root: string, bundle: string, files = ownedFiles(root)): BundleStamp {
  const stamp: BundleStamp = {
    version: 2,
    bundle,
    seededAt: new Date().toISOString(),
    files: describe(root, files)
  }

  fs.writeFileSync(path.join(root, STAMP_NAME), JSON.stringify(stamp), 'utf8')

  return stamp
}

/**
 * Has anything the stamp claims changed since it was written?
 *
 * Exact, by content. Cheap heuristics belong to checks that run constantly;
 * this one runs when an update is available and is the last thing standing
 * between a new build and someone's edits.
 */
export function locallyModified(root: string, stamp: BundleStamp): string[] {
  const now = describe(root, Object.keys(stamp.files))

  return Object.keys(stamp.files).filter(rel => now[rel] !== stamp.files[rel])
}

export interface RefreshDeps {
  copy: (from: string, to: string) => void
  remove: (target: string) => void
  exists: (target: string) => boolean
  /** Runs against the canonical source path, before committing the update. */
  prepareRuntime?: (context: { installed: string; previous: string; depsChanged: boolean }) => Promise<void>
}

const REAL: RefreshDeps = {
  copy: (from, to) => {
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
  },
  remove: target => fs.rmSync(target, { force: true }),
  exists: target => fs.existsSync(target)
}

function safeRelativePath(rel: string): boolean {
  return Boolean(rel) && !rel.includes('\\') && !path.posix.isAbsolute(rel) &&
    !rel.split('/').some(part => !part || part === '.' || part === '..')
}

function safeInstalledPath(root: string, rel: string): boolean {
  if (!safeRelativePath(rel)) {return false}
  let current = root

  for (const part of rel.split('/')) {
    current = path.join(current, part)

    try {
      if (fs.lstatSync(current).isSymbolicLink()) {return false}
    } catch (error: any) {
      if (error.code !== 'ENOENT') {return false}
    }
  }

  return true
}

interface UpdateJournal {
  version: 1
  work: string
  retained: string[]
  committed: boolean
}

const journalPath = (installed: string) => `${installed}.daat-update.json`
const pending = new Map<string, Promise<RefreshOutcome>>()

function saveJournal(installed: string, journal: UpdateJournal): void {
  const file = journalPath(installed)
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(journal), { mode: 0o600 })
  fs.renameSync(`${file}.tmp`, file)
}

/** Recover an interrupted source/dependency swap before probing runtime health. */
export function recoverAgentSource(installed: string): boolean {
  const file = journalPath(installed)

  if (!fs.existsSync(file)) {return false}

  // A sibling desktop may be validating the replacement right now.
  try {
    const owner = Number(fs.readFileSync(`${installed}.daat-update.lock`, 'utf8'))

    if (Number.isInteger(owner) && owner > 0 && owner !== process.pid) {
      try { process.kill(owner, 0);

 return false } catch (error: any) { if (error.code !== 'ESRCH') {throw error} }
    }
  } catch (error: any) { if (error.code !== 'ENOENT' && error.code !== 'ESRCH') {throw error} }

  const journal = JSON.parse(fs.readFileSync(file, 'utf8')) as UpdateJournal
  const parent = path.dirname(installed)

  if (journal.version !== 1 || path.dirname(journal.work) !== parent ||
      !path.basename(journal.work).startsWith(`.${path.basename(installed)}-update-`) ||
      !Array.isArray(journal.retained) || journal.retained.some(name => !['venv', '.venv', 'node_modules'].includes(name))) {
    throw new Error('Unrecognized agent update journal; recovery files were preserved.')
  }

  const previous = path.join(journal.work, 'previous')

  if (!journal.committed && fs.existsSync(previous)) {
    for (const name of journal.retained) {
      const current = path.join(installed, name)
      const original = path.join(previous, name)

      if (fs.existsSync(current) && !fs.existsSync(original)) {fs.renameSync(current, original)}
    }

    fs.rmSync(installed, { recursive: true, force: true })
    fs.renameSync(previous, installed)
  }

  fs.rmSync(journal.work, { recursive: true, force: true })
  fs.rmSync(file, { force: true })

  return true
}

/** One transaction per managed source tree, including runtime validation. */
export function refreshAgentSource(installed: string, bundle: string, deps: RefreshDeps = REAL): Promise<RefreshOutcome> {
  const existing = pending.get(installed)

  if (existing) {return existing}
  const run = refreshSource(installed, bundle, deps).finally(() => pending.delete(installed))
  pending.set(installed, run)

  return run
}

async function refreshSource(installed: string, bundle: string, deps: RefreshDeps): Promise<RefreshOutcome> {
  const lock = `${installed}.daat-update.lock`
  let locked = false
  let work: string | undefined

  try {
    // A second desktop process must not recover or overwrite an active update.
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 })
      locked = true
    } catch (error: any) {
      if (error.code !== 'EEXIST') {throw error}
      const pid = Number(fs.readFileSync(lock, 'utf8'))
      let alive = Number.isInteger(pid) && pid > 0

      if (alive) {
        try { process.kill(pid, 0) } catch (probe: any) { alive = probe.code !== 'ESRCH' }
      }

      if (alive) {return { action: 'unavailable', why: 'another agent update is in progress' }}
      fs.rmSync(lock)
      fs.writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 })
      locked = true
    }

    recoverAgentSource(installed)

    if (!deps.exists(bundle)) {return { action: 'unavailable', why: 'no bundled source in this build' }}

    if (!deps.exists(installed)) {return { action: 'unavailable', why: 'nothing installed yet — seeding handles this' }}

    if (fs.lstatSync(installed).isSymbolicLink()) {return { action: 'declined', why: 'path-conflict', detail: 'The install root is a symlink; its owner must manage updates.' }}

    if (deps.exists(path.join(installed, '.git'))) {
      return { action: 'declined', why: 'git-checkout', detail: 'this install is a git checkout; update it with git' }
    }

    const stamp = readStamp(installed)
    const incomingId = bundleFingerprint(bundle)

    if (stamp?.bundle === incomingId) {return { action: 'current' }}

    if (!stamp) {
      // A stopped initial copy can leave the bundle id but no ownership stamp.
      // Only adopt files proven identical to this exact bundle, never user edits.
      const idPath = path.join(installed, BUNDLE_ID_NAME)
      if (!safeInstalledPath(installed, BUNDLE_ID_NAME) || !fs.existsSync(idPath) ||
          fs.readFileSync(idPath, 'utf8').trim() !== incomingId ||
          fs.existsSync(path.join(installed, STAMP_NAME))) {
        return { action: 'declined', why: 'no-stamp', detail: 'the existing source has unknown ownership' }
      }
      const incoming = ownedFiles(bundle)
      const expected = describe(bundle, incoming)
      for (const rel of [...incoming, STAMP_NAME]) {
        if (!safeInstalledPath(installed, rel)) {
          return { action: 'declined', why: 'path-conflict', detail: `Unsafe recovery path: ${rel}` }
        }
        if (fs.existsSync(path.join(installed, rel)) &&
            describe(installed, [rel])[rel] !== expected[rel]) {
          return { action: 'declined', why: 'locally-modified', detail: `Recovery preserved a changed file: ${rel}` }
        }
      }
      for (const rel of incoming) {
        if (expected[rel] === 'missing') {throw new Error(`Unreadable bundled source: ${rel}`)}
        const target = path.join(installed, rel)
        if (!fs.existsSync(target)) {
          fs.mkdirSync(path.dirname(target), { recursive: true })
          fs.copyFileSync(path.join(bundle, rel), target, fs.constants.COPYFILE_EXCL)
        }
      }
      const copied = describe(installed, incoming)
      if (incoming.some(rel => copied[rel] !== expected[rel])) {throw new Error('Recovered source verification failed')}
      writeStamp(installed, incomingId, incoming)
      return { action: 'seeded', files: incoming.length }
    }
    const incoming = ownedFiles(bundle)
    const previousFiles = Object.keys(stamp.files)

    const conflict = [...new Set([...previousFiles, ...incoming])].find(rel =>
      !safeInstalledPath(installed, rel) ||
      (incoming.includes(rel) && !(rel in stamp.files) && deps.exists(path.join(installed, rel))))

    if (conflict) {return { action: 'declined', why: 'path-conflict', detail: `Existing user path conflicts with the update: ${conflict}` }}
    const touched = locallyModified(installed, stamp)

    if (touched.length) {return { action: 'declined', why: 'locally-modified', detail: `${touched.length} file(s) changed: ${touched.slice(0, 3).join(', ')}` }}
    const depsChanged = ['pyproject.toml', 'uv.lock'].some(name => stamp.files[name] !== describe(bundle, [name])[name] && (incoming.includes(name) || name in stamp.files))

    if (depsChanged && !deps.prepareRuntime) {
      return { action: 'declined', why: 'runtime-check-required', detail: 'The new source needs a verified dependency update.' }
    }

    // Legacy v1 stamps may already include user files. Their removed paths
    // have ambiguous ownership, so preserve them during the one-time migration.
    const removed = stamp.version === 2 ? previousFiles.filter(rel => !incoming.includes(rel)) : []
    work = fs.mkdtempSync(path.join(path.dirname(installed), `.${path.basename(installed)}-update-`))
    const staged = path.join(work, 'staged')
    const previous = path.join(work, 'previous')
    // Only the canonical venv is rebuilt. A user's additional .venv is not ours.
    const retained = ['node_modules', '.venv', ...(depsChanged ? [] : ['venv'])]
    fs.cpSync(installed, staged, {
      recursive: true,
      verbatimSymlinks: true,
      filter: source => !(path.dirname(source) === installed && ['venv', '.venv', 'node_modules'].includes(path.basename(source)))
    })

    for (const rel of removed) {deps.remove(path.join(staged, rel))}

    for (const rel of incoming) {deps.copy(path.join(bundle, rel), path.join(staged, rel))}
    const expected = describe(bundle, incoming)
    const copied = describe(staged, incoming)

    if (incoming.some(rel => copied[rel] !== expected[rel] || copied[rel] === 'missing')) {throw new Error('Staged source verification failed')}
    const journal: UpdateJournal = { version: 1, work, retained, committed: false }
    saveJournal(installed, journal)
    fs.renameSync(installed, previous)
    fs.renameSync(staged, installed)

    for (const name of retained) {
      if (fs.existsSync(path.join(previous, name))) {fs.renameSync(path.join(previous, name), path.join(installed, name))}
    }

    await deps.prepareRuntime?.({ installed, previous, depsChanged })
    writeStamp(installed, incomingId, incoming)
    fs.writeFileSync(path.join(installed, BUNDLE_ID_NAME), incomingId)
    journal.committed = true
    saveJournal(installed, journal)

    // A cleanup failure leaves a committed journal; recovery only removes its
    // backup and never rolls a successfully validated runtime backwards.
    try { recoverAgentSource(installed) } catch { /* retry cleanup next launch */ }

    return { action: 'updated', depsChanged, files: incoming.length, from: stamp.bundle.slice(0, 12), removed: removed.length, to: incomingId.slice(0, 12) }
  } catch (error: any) {
    if (fs.existsSync(journalPath(installed))) {
      try { recoverAgentSource(installed) } catch (recovery: any) {
        throw new Error(`Agent update recovery failed: ${recovery.message}. Previous files are preserved at ${work || journalPath(installed)}.`)
      }
    } else if (work) {
      fs.rmSync(work, { recursive: true, force: true })
    }

    return { action: 'failed', why: error.message }
  } finally {
    if (locked) {fs.rmSync(lock, { force: true })}
  }
}
