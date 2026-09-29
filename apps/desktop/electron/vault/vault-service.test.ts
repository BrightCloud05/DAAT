import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, test, vi } from 'vitest'

const environment = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({
  app: { getPath: (name: string) => `${environment.root}/${name}` },
  shell: {
    trashItem: async () => {
      throw new Error('trash must not be reached for stale roots')
    }
  }
}))
vi.mock('./vault-watcher', () => ({ watchVault: async () => ({ close: async () => {} }) }))

import { VaultService } from './vault-service'

let service: VaultService
let a: string, b: string
beforeEach(async () => {
  environment.root = await fs.mkdtemp(path.join(os.tmpdir(), 'daat-service-'))
  a = path.join(environment.root, 'vault-a')
  b = path.join(environment.root, 'vault-b')
  await fs.mkdir(a)
  await fs.mkdir(b)
  service = new VaultService({ onIndexEvent: () => {}, onConflict: () => {} })
})
afterEach(async () => {
  await service.close()
  await fs.rm(environment.root, { recursive: true, force: true })
})

async function open(root: string) {
  await service.open(root)
  await vi.waitFor(() => assert.equal(service.info().indexing, false), { timeout: 5000 })
}

test('stale vault identity is refused by every mutation boundary', async () => {
  await fs.writeFile(path.join(a, 'Note.md'), 'vault A')
  await fs.writeFile(path.join(b, 'Note.md'), 'vault B')
  await open(a)
  const note = await service.read('Note.md')
  await open(b)
  const root = note.vaultRoot

  const calls = [
    () => service.write('Note.md', 'wrong', note.mtimeMs, note.content, root),
    () => service.createNote('New.md', root),
    () => service.rename('Note.md', 'Gone.md', root),
    () => service.trash('Note.md', root),
    () => service.createDir('NewDir', root),
    () => service.appendBinary('audio.wav', new Uint8Array([1]), root),
    () => service.writeBinary('audio.wav', new Uint8Array([1]), root),
    () => service.toggleTodo('Note.md', 1, 'task', root)
  ]

  for (const call of calls) {
    await assert.rejects(call(), /vault changed/)
  }

  assert.equal(await fs.readFile(path.join(a, 'Note.md'), 'utf8'), 'vault A')
  assert.equal(await fs.readFile(path.join(b, 'Note.md'), 'utf8'), 'vault B')
})

test('all indexed tasks are visible and incremental edits remove stale tasks', async () => {
  for (let i = 0; i < 310; i++) {
    await fs.writeFile(path.join(a, `${i}.md`), `# Note\n- [ ] Task ${i}\n- [x] Done ${i}\n`)
  }

  await open(a)
  assert.equal((await service.todos()).length, 620)
  assert.equal((await service.todos(5)).length, 5)
  const note = await service.read('0.md')
  await service.write('0.md', '# Now empty\n', note.mtimeMs, note.content, note.vaultRoot)
  await vi.waitFor(async () => assert.equal((await service.todos()).length, 618))
  assert.ok(!(await service.todos()).some(todo => todo.path === '0.md'))
})

test('creating a cloud placeholder note does not overwrite its remote content', async () => {
  await fs.writeFile(path.join(a, '.Cloud.md.icloud'), 'placeholder plist')
  await open(a)
  const result = await service.createNote('Cloud.md')
  assert.equal(result.created, false)
  assert.equal(result.dataless, true)
  await assert.rejects(fs.access(path.join(a, 'Cloud.md')))
})
