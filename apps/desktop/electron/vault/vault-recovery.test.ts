import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import { VaultRecovery } from './vault-recovery'
import type { VaultRecoveryEntry } from './vault-types'

test('recovery survives a new process and keeps vaults and editors separate', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'daat-recovery-'))
  const journal = new VaultRecovery(root)

  const entry: VaultRecoveryEntry = {
    id: 'editor-a',
    vaultRoot: '/vault-a',
    path: 'Note.md',
    content: 'draft',
    baseContent: 'old',
    mtimeMs: 1,
    updatedAt: 1
  }

  try {
    await Promise.all([
      journal.save(entry),
      journal.save({ ...entry, content: 'latest', updatedAt: 2 }),
      journal.save({ ...entry, id: 'editor-b', content: 'another window' }),
      journal.save({ ...entry, id: 'vault-b', vaultRoot: '/vault-b', content: 'other vault' })
    ])
    const restarted = new VaultRecovery(root)
    assert.deepEqual((await restarted.list('/vault-a')).map(entry => entry.content).sort(), [
      'another window',
      'latest'
    ])
    assert.equal((await restarted.list('/vault-b'))[0].content, 'other vault')
    await restarted.remove('editor-a')
    assert.equal((await restarted.list('/vault-a')).length, 1)
    assert.ok((await fs.readdir(root)).every(name => name.endsWith('.json')))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('a remove waits for its pending save instead of recreating stale recovery', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'daat-recovery-'))
  const journal = new VaultRecovery(root)

  try {
    const entry: VaultRecoveryEntry = {
      id: '../unsafe/id',
      vaultRoot: '/vault',
      path: 'Note.md',
      content: 'draft',
      baseContent: '',
      mtimeMs: 0,
      updatedAt: 1
    }

    await Promise.all([journal.save(entry), journal.remove(entry.id)])
    assert.deepEqual(await journal.list('/vault'), [])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
