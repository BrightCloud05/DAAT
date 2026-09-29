/**
 * Archiving is a move, and the destination is named differently everywhere.
 * Getting it wrong does not look like an error to the user — it looks like
 * their mail disappeared.
 */

import assert from 'node:assert/strict'

import { test } from 'vitest'

import { archiveFolder, nextAfter, TRASH_ALIAS, trashFolder } from './mail-actions'

const GMAIL = ['INBOX', '[Gmail]/All Mail', '[Gmail]/Sent Mail', '[Gmail]/Trash', '[Gmail]/Spam']
const FASTMAIL = ['INBOX', 'Archive', 'Drafts', 'Sent', 'Trash', 'Spam']
const OUTLOOK = ['Inbox', 'Archive', 'Sent Items', 'Deleted Items', 'Junk Email']
const DOVECOT = ['INBOX', 'INBOX.Archive', 'INBOX.Sent', 'INBOX.Trash']

test('each provider resolves to its own archive folder', () => {
  assert.equal(archiveFolder(GMAIL), '[Gmail]/All Mail')
  assert.equal(archiveFolder(FASTMAIL), 'Archive')
  assert.equal(archiveFolder(OUTLOOK), 'Archive')
  assert.equal(archiveFolder(DOVECOT), 'INBOX.Archive')
})

test('and to its own trash', () => {
  assert.equal(trashFolder(GMAIL), '[Gmail]/Trash')
  assert.equal(trashFolder(FASTMAIL), 'Trash')
  assert.equal(trashFolder(OUTLOOK), 'Deleted Items')
  assert.equal(trashFolder(DOVECOT), 'INBOX.Trash')
})

test('a server in another language still works', () => {
  assert.equal(archiveFolder(['INBOX', 'Archiv', 'Gesendet']), 'Archiv')
  assert.equal(trashFolder(['INBOX', 'Archiv', 'Papierkorb']), 'Papierkorb')
})

test('no matching folder returns null rather than inventing one', () => {
  // The caller must say "this account has nowhere to archive to". Creating a
  // folder, or moving to a guess, is how mail ends up somewhere the user will
  // never look.
  assert.equal(archiveFolder(['INBOX', 'Sent']), null)
  assert.equal(trashFolder(['INBOX', 'Sent']), null)
  assert.equal(archiveFolder([]), null)
})

test('the exact name wins over a nested one', () => {
  assert.equal(archiveFolder(['INBOX', 'INBOX.Archive', 'Archive']), 'Archive')
})

test('junk in the folder list is ignored, not matched', () => {
  assert.equal(archiveFolder(['INBOX', '', '   ', 'Archive']), 'Archive')
})

test('triage moves to the next message, not back to the top', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  assert.deepEqual(nextAfter(rows, 'a'), { id: 'b' })
  assert.deepEqual(nextAfter(rows, 'b'), { id: 'c' })
})

test('the last message falls back to the one before it', () => {
  const rows = [{ id: 'a' }, { id: 'b' }]

  assert.deepEqual(nextAfter(rows, 'b'), { id: 'a' })
})

test('an emptied inbox selects nothing', () => {
  assert.equal(nextAfter([], 'a'), null)
  assert.equal(nextAfter([{ id: 'only' }], 'only'), null)
})

test("an account whose folders are not in English is the alias's job, not the list's", () => {
  // Joseph's own personal account: folder.aliases.trash = "[Gmail]/휴지통".
  // The name list happens to contain 휴지통 and would match — but matching
  // translated folder names by hand is luck, and the alias is the answer the
  // user actually wrote down. TRASH_ALIAS is what the caller sends first.
  assert.equal(TRASH_ALIAS, 'trash')
  assert.equal(trashFolder(['INBOX', '[Gmail]/휴지통']), '[Gmail]/휴지통')
})

test('archive usually has no alias, which is why the list still exists', () => {
  // himalaya's setup asks for inbox/sent/drafts/trash — not archive. So the
  // fallback carries archive on its own for most accounts.
  assert.equal(archiveFolder(['INBOX', '[Gmail]/All Mail']), '[Gmail]/All Mail')
})

test('configured aliases win over detected names and a missing alias falls back within the same account', async () => {
  const { moveMail } = await import('./mail-actions')
  const calls: unknown[] = []
  const identity = { id: '42', account: 'work', folder: 'INBOX' }
  await moveMail(
    async options => {
      calls.push(options)
    },
    identity,
    'archive',
    GMAIL
  )
  assert.deepEqual(calls, [{ ...identity, target: 'archive' }])
  calls.length = 0
  await moveMail(
    async options => {
      calls.push(options)

      if (options.target === 'trash') {throw new Error('NO [NONEXISTENT] mailbox does not exist')}
    },
    identity,
    'trash',
    GMAIL
  )
  assert.deepEqual(calls, [
    { ...identity, target: 'trash' },
    { ...identity, target: '[Gmail]/Trash' }
  ])
})

test('a timeout during a mail move is never retried against a guessed mailbox', async () => {
  const { moveMail } = await import('./mail-actions')
  let attempts = 0
  await assert.rejects(
    moveMail(
      async () => {
        attempts++
        throw new Error('Request timed out')
      },
      { id: '42', account: 'work', folder: 'INBOX' },
      'archive',
      GMAIL
    ),
    /timed out/
  )
  assert.equal(attempts, 1)
})
