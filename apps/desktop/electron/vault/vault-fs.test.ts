import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'vitest'

import {
  contentHash,
  icloudPlaceholderTarget,
  isMarkdownFile,
  readNote,
  resolveInVault,
  toVaultRelative,
  writeNote
} from './vault-fs'

async function tmpVault(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'biseo-vault-test-'))
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

test('contentHash is stable per content', () => {
  assert.equal(contentHash('abc'), contentHash('abc'))
  assert.notEqual(contentHash('abc'), contentHash('abd'))
})
