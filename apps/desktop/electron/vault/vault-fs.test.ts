import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import {
  contentHash,
  icloudPlaceholderTarget,
  isMarkdownFile,
  moveWithoutOverwrite,
  readNote,
  resolveInVault,
  toVaultRelative,
  writeNote
} from './vault-fs'

async function tmpVault(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'daat-vault-test-'))
}

test('icloudPlaceholderTarget unwraps evicted placeholder names', () => {
  assert.equal(icloudPlaceholderTarget('.Note.md.icloud'), 'Note.md')
  assert.equal(icloudPlaceholderTarget('.한글 노트.md.icloud'), '한글 노트.md')
  assert.equal(icloudPlaceholderTarget('Note.md'), null)
  assert.equal(icloudPlaceholderTarget('.hidden'), null)
})

test('isMarkdownFile accepts md/markdown case-insensitively', () => {
  assert.equal(isMarkdownFile('a.md'), true)
  assert.equal(isMarkdownFile('a.MD'), true)
  assert.equal(isMarkdownFile('a.markdown'), true)
  assert.equal(isMarkdownFile('a.txt'), false)
})

test('resolveInVault refuses escapes and normalizes separators', async () => {
  const root = await tmpVault()

  assert.equal(resolveInVault(root, 'a/b.md'), path.join(root, 'a', 'b.md'))
  assert.equal(resolveInVault(root, 'a\\b.md'), path.join(root, 'a', 'b.md'))
  assert.throws(() => resolveInVault(root, '../outside.md'))
  assert.throws(() => resolveInVault(root, 'a/../../outside.md'))
  assert.equal(toVaultRelative(root, path.join(root, 'a', 'b.md')), 'a/b.md')
})

test('writeNote is atomic and round-trips through readNote', async () => {
  const root = await tmpVault()
  const target = path.join(root, 'sub', 'Note.md')
  const write = await writeNote(target, '# Hello\n', null)

  assert.equal(write.ok, true)

  const read = await readNote(target)

  assert.equal(read.content, '# Hello\n')
  assert.equal(read.dataless, false)
  assert.ok(Math.abs(read.mtimeMs - write.mtimeMs) < 1)

  // No leftover temp files from the atomic write.
  const entries = await fs.readdir(path.dirname(target))

  assert.deepEqual(entries, ['Note.md'])
})

test('writeNote diverts to a conflict copy when disk moved past expectedMtime', async () => {
  const root = await tmpVault()
  const target = path.join(root, 'Note.md')
  const first = await writeNote(target, 'mine v1', null)

  // Simulate a remote edit landing: content + newer mtime.
  await fs.writeFile(target, 'theirs v2', 'utf8')
  await fs.utimes(target, new Date(), new Date(Date.now() + 5_000))

  const write = await writeNote(target, 'mine v2', first.mtimeMs)

  assert.equal(write.ok, false)
  assert.ok(write.conflictPath?.includes('(conflict '))
  // Disk copy untouched; caller's content preserved in the conflict copy.
  assert.equal(await fs.readFile(target, 'utf8'), 'theirs v2')
  assert.equal(await fs.readFile(write.conflictPath!, 'utf8'), 'mine v2')
})

test('writeNote skips rewriting unchanged content', async () => {
  const root = await tmpVault()
  const target = path.join(root, 'Note.md')
  const first = await writeNote(target, 'same', null)
  const again = await writeNote(target, 'same', first.mtimeMs)

  assert.equal(again.ok, true)
  assert.equal(again.mtimeMs, first.mtimeMs)
})

/*
 * The default configuration is an iCloud vault with "Optimize Mac Storage" on,
 * which evicts note contents and leaves a file that still stats fine but whose
 * bytes will not come back until iCloud downloads them.
 *
 * readNote hands such a note to the editor as EMPTY with its real mtime. Both
 * of writeNote's guards then used to pass vacuously — the mtime matched, and
 * the byte comparison had nothing to compare — so the empty document was
 * written over a year of writing, and iCloud carried that to every device.
 *
 * chmod 000 stands in for the eviction: the cause of the failed read (blocked
 * open vs. refused open) does not matter, only that the current bytes are
 * unknown. It is instant, where a real blocking read costs the 4s timeout.
 */
test('an evicted note is not overwritten by the emptiness the editor was given', async ({ skip }) => {
  skip(process.getuid?.() === 0, 'root reads mode-000 files, so nothing is unreadable')

  const root = await tmpVault()
  const file = path.join(root, 'Note.md')
  const real = '# Real\n\nA year of writing.\n'

  await fs.writeFile(file, real, 'utf8')

  // Exactly what readNote returns for an evicted note, and therefore exactly
  // what the editor holds and hands back on the next autosave.
  const { mtimeMs, content } = { mtimeMs: (await fs.stat(file)).mtimeMs, content: '' }

  await fs.chmod(file, 0o000)

  const result = await writeNote(file, content, mtimeMs, content)

  await fs.chmod(file, 0o644)

  assert.equal(result.ok, false)
  assert.equal(result.unreadable, true)
  assert.equal(await fs.readFile(file, 'utf8'), real, 'the note is still there')

  await fs.rm(root, { force: true, recursive: true })
})

test('a knowing overwrite of an unreadable file is still allowed', async ({ skip }) => {
  // `expectedMtimeMs === null` is a caller saying it does not care what is
  // there — seeding a template, restoring a file. Refusing those would break
  // legitimate writes; the refusal is only for callers editing on top of
  // something they believe they read.
  skip(process.getuid?.() === 0, 'root reads mode-000 files, so nothing is unreadable')

  const root = await tmpVault()
  const file = path.join(root, 'Note.md')

  await fs.writeFile(file, 'old', 'utf8')
  await fs.chmod(file, 0o000)

  const result = await writeNote(file, 'deliberate', null)

  await fs.chmod(file, 0o644).catch(() => undefined)

  assert.equal(result.ok, true)
  assert.equal(await fs.readFile(file, 'utf8'), 'deliberate')

  await fs.rm(root, { force: true, recursive: true })
})

test('a legacy .icloud placeholder is not paved over with a fresh file', async () => {
  // The older eviction form: `Note.md` is absent under its own name and only
  // `.Note.md.icloud` is on disk. stat() fails, so the write used to sail past
  // every guard and create a new file — replacing a note that still exists.
  const root = await tmpVault()

  await fs.writeFile(path.join(root, '.Note.md.icloud'), 'plist', 'utf8')

  const result = await writeNote(path.join(root, 'Note.md'), 'replacement', 0, '')

  assert.equal(result.ok, false)
  assert.equal(result.unreadable, true)
  assert.equal(await fs.readFile(path.join(root, 'Note.md'), 'utf8').catch(() => null), null)

  await fs.rm(root, { force: true, recursive: true })
})

test('two conflicts in the same minute get two files', async () => {
  // The stamp used to be minute-resolution with no existence check, so a save
  // loop retrying against a file iCloud keeps touching overwrote the previous
  // conflict copy — losing the writing the copy existed to preserve.
  const root = await tmpVault()
  const file = path.join(root, 'Note.md')

  await fs.writeFile(file, 'disk', 'utf8')

  const stale = (await fs.stat(file)).mtimeMs - 10_000

  const first = await writeNote(file, 'mine one', stale, 'mine one')
  const second = await writeNote(file, 'mine two', stale, 'mine two')

  assert.equal(first.ok, false)
  assert.equal(second.ok, false)
  assert.notEqual(first.conflictPath, second.conflictPath)
  assert.equal(await fs.readFile(first.conflictPath!, 'utf8'), 'mine one')
  assert.equal(await fs.readFile(second.conflictPath!, 'utf8'), 'mine two')

  await fs.rm(root, { force: true, recursive: true })
})

test('a failed write leaves no temp file behind', async () => {
  // The temp files are dot-files, so they accumulate unseen — and iCloud syncs
  // every one of them to every device.
  const root = await tmpVault()
  const target = path.join(root, 'Note.md')

  await fs.mkdir(target)

  await assert.rejects(writeNote(target, 'content', null))

  const left = (await fs.readdir(root)).filter(name => name.includes('.tmp-'))

  assert.deepEqual(left, [])

  await fs.rm(root, { force: true, recursive: true })
})

test('contentHash is stable per content', () => {
  assert.equal(contentHash('abc'), contentHash('abc'))
  assert.notEqual(contentHash('abc'), contentHash('abd'))
})

test('existing and new paths through external symlinks are refused', async () => {
  const root = await tmpVault()
  const outside = await tmpVault()

  try {
    await fs.writeFile(path.join(outside, 'private.md'), 'private')
    await fs.symlink(path.join(outside, 'private.md'), path.join(root, 'link.md'))
    await fs.symlink(outside, path.join(root, 'linked-folder'))
    assert.throws(() => resolveInVault(root, 'link.md'), /escapes/)
    assert.throws(() => resolveInVault(root, 'linked-folder/new.md'), /escapes/)
    await fs.mkdir(path.join(root, 'inside'))
    await fs.symlink(path.join(root, 'inside'), path.join(root, 'safe-link'))
    assert.equal(resolveInVault(root, 'safe-link/new.md'), path.join(root, 'safe-link/new.md'))
  } finally {
    await fs.rm(root, { force: true, recursive: true })
    await fs.rm(outside, { force: true, recursive: true })
  }
})

test('rename refuses an existing destination and preserves both notes', async () => {
  const root = await tmpVault()

  try {
    const from = path.join(root, 'A.md'),
      to = path.join(root, 'B.md')

    await fs.writeFile(from, 'A')
    await fs.writeFile(to, 'B')
    await assert.rejects(moveWithoutOverwrite(from, to), /already exists/)
    assert.equal(await fs.readFile(from, 'utf8'), 'A')
    assert.equal(await fs.readFile(to, 'utf8'), 'B')
  } finally {
    await fs.rm(root, { force: true, recursive: true })
  }
})

test('concurrent renames to one destination cannot overwrite the winner', async () => {
  const root = await tmpVault()

  try {
    const a = path.join(root, 'A.md'),
      b = path.join(root, 'B.md'),
      target = path.join(root, 'Target.md')

    await fs.writeFile(a, 'A')
    await fs.writeFile(b, 'B')
    const results = await Promise.allSettled([moveWithoutOverwrite(a, target), moveWithoutOverwrite(b, target)])
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
    const winner = await fs.readFile(target, 'utf8')
    assert.equal(await fs.readFile(winner === 'A' ? b : a, 'utf8'), winner === 'A' ? 'B' : 'A')
  } finally {
    await fs.rm(root, { force: true, recursive: true })
  }
})

test('folder and case-only rename keep all contents', async () => {
  const root = await tmpVault()

  try {
    await fs.mkdir(path.join(root, 'Old/sub'), { recursive: true })
    await fs.writeFile(path.join(root, 'Old/sub/Note.md'), 'preserved')
    await moveWithoutOverwrite(path.join(root, 'Old'), path.join(root, 'New'))
    await moveWithoutOverwrite(path.join(root, 'New/sub/Note.md'), path.join(root, 'New/sub/note.md'))
    assert.equal(await fs.readFile(path.join(root, 'New/sub/note.md'), 'utf8'), 'preserved')
    await assert.rejects(fs.stat(path.join(root, 'Old')))
  } finally {
    await fs.rm(root, { force: true, recursive: true })
  }
})

test('simultaneous saves from the same base preserve every submitted version', async () => {
  const root = await tmpVault()

  try {
    const target = path.join(root, 'Shared.md')
    await fs.writeFile(target, 'original')
    const before = await readNote(target)
    const versions = ['window one', 'window two', 'window three']

    const results = await Promise.all(
      versions.map(content => writeNote(target, content, before.mtimeMs, before.content))
    )

    assert.equal(results.filter(result => result.ok).length, 1)
    const saved = await Promise.all((await fs.readdir(root)).map(name => fs.readFile(path.join(root, name), 'utf8')))
    assert.deepEqual(saved.sort(), [...versions].sort())
  } finally {
    await fs.rm(root, { force: true, recursive: true })
  }
})

test('moving a folder into itself is refused without modifying its contents', async () => {
  const root = await tmpVault()

  try {
    const folder = path.join(root, 'Folder')
    await fs.mkdir(folder)
    await fs.writeFile(path.join(folder, 'Note.md'), 'keep')
    await assert.rejects(moveWithoutOverwrite(folder, path.join(folder, 'Sub')), /inside itself/)
    assert.deepEqual(await fs.readdir(folder), ['Note.md'])
  } finally {
    await fs.rm(root, { force: true, recursive: true })
  }
})
