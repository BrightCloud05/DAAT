/**
 * The two functions standing between the renderer and himalaya's argv.
 *
 * Mail values — folder, account, flag, message id, search box — arrive over
 * IPC, which makes them exactly as trustworthy as the renderer. himalaya reads
 * a leading dash as a flag, and its own `-c/--config` will load an arbitrary
 * TOML whose `auth.cmd` runs a shell command. That hole was closed once in
 * plugins/mail/himalaya.py; these keep it closed on the desktop side too.
 */

import assert from 'node:assert/strict'

import { test } from 'vitest'

import { safeName, searchTerms } from './mail-ipc'

test('ordinary names pass through, trimmed', () => {
  assert.equal(safeName('  INBOX  ', 'folder'), 'INBOX')
  assert.equal(safeName('Archive/2026', 'folder'), 'Archive/2026')
  assert.equal(safeName('personal', 'account'), 'personal')
})

test('a leading dash is refused, because argv would read it as a flag', () => {
  assert.throws(() => safeName('-c', 'folder'), /invalid-folder/)
  assert.throws(() => safeName('--config=/tmp/evil.toml', 'account'), /invalid-account/)
})

test('control characters are refused', () => {
  assert.throws(() => safeName('INBOX\nrm -rf', 'folder'), /invalid-folder/)
  assert.throws(() => safeName('a\r\nb', 'folder'), /invalid-folder/)
  assert.throws(() => safeName('a\0b', 'folder'), /invalid-folder/)
})

test('empty is refused rather than defaulted', () => {
  // A silent default here would move mail to a folder nobody chose.
  assert.throws(() => safeName('   ', 'target folder'), /invalid-target-folder/)
  assert.throws(() => safeName(undefined as unknown as string, 'message id'), /invalid-message-id/)
})

test('a search splits into terms the way himalaya expects', () => {
  assert.deepEqual(searchTerms('from dana'), ['from', 'dana'])
  assert.deepEqual(searchTerms('  after 2026-07-01   and from ato '), ['after', '2026-07-01', 'and', 'from', 'ato'])
})

test('a quoted phrase stays one term', () => {
  // Shredded into three, this matches mail containing "invoice" OR "42"
  // somewhere — a query that silently finds the wrong thing rather than
  // failing, which is the worse outcome.
  assert.deepEqual(searchTerms('subject "invoice 42"'), ['subject', 'invoice 42'])
})

test('flag-shaped terms are dropped, not escaped', () => {
  // `--` only protects the first positional; a later dash-led word is read as
  // a flag again. Dropping it is honest — guessing an escape is not.
  assert.deepEqual(searchTerms('from dana -c /tmp/evil.toml'), ['from', 'dana', '/tmp/evil.toml'])
})

test('an empty search asks for nothing rather than listing everything', () => {
  assert.deepEqual(searchTerms(''), [])
  assert.deepEqual(searchTerms('   '), [])
})
