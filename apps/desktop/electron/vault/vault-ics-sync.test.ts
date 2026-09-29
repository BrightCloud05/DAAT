import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, test, vi } from 'vitest'
const environment = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({
  app: { getPath: (name: string) => `${environment.root}/${name}` },
  shell: {
    trashItem: async (file: string) => {
      await fs.rm(file)
    }
  },
  ipcMain: { handle: vi.fn() }
}))
vi.mock('./vault-watcher', () => ({ watchVault: async () => ({ close: async () => {} }) }))
import { loadSubscriptions, syncSubscriptions } from './vault-ics'
import { VaultService } from './vault-service'
let service: VaultService
let root: string
const subscription = { id: 'one', name: 'Test calendar', url: 'https://calendar.invalid/feed', addedAt: 1 }

const feed = (title: string) =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:stable',
    `DTSTART;VALUE=DATE:${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`,
    `SUMMARY:${title}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n')

async function settings(subscriptions = [subscription]) {
  await fs.mkdir(path.join(environment.root, 'userData'), { recursive: true })
  await fs.writeFile(
    path.join(environment.root, 'userData', 'calendar-subscriptions.json'),
    JSON.stringify({ subscriptions })
  )
}

beforeEach(async () => {
  environment.root = await fs.mkdtemp(path.join(os.tmpdir(), 'daat-ics-'))
  root = path.join(environment.root, 'notes')
  await fs.mkdir(root)
  service = new VaultService({ onIndexEvent: () => {}, onConflict: () => {} })
  await service.open(root)
  root = service.info().root!
  await vi.waitFor(() => assert.equal(service.info().indexing, false))
  await settings()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(feed('Original')))
  )
})
afterEach(async () => {
  await service.close()
  vi.unstubAllGlobals()
  await fs.rm(environment.root, { recursive: true, force: true })
})

async function imported(): Promise<string> {
  const entries = await fs.readdir(path.join(root, 'Calendar/Sync'), { recursive: true })
  const note = entries.find(file => file.endsWith('.md'))!
  assert.ok(note)

  return path.join(root, 'Calendar/Sync', note)
}

test('failed and invalid feeds preserve notes; refresh updates the event while preserving appended user notes', async () => {
  assert.equal((await syncSubscriptions(service)).written, 1)
  const file = await imported()
  await fs.appendFile(file, 'My private meeting notes\n')
  const previous = await fs.readFile(file, 'utf8')
  vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))
  assert.equal((await syncSubscriptions(service)).removed, 0)
  assert.equal(await fs.readFile(file, 'utf8'), previous)
  vi.mocked(fetch).mockResolvedValueOnce(new Response('<html>unavailable</html>'))
  assert.ok((await syncSubscriptions(service)).errors.length)
  assert.equal(await fs.readFile(file, 'utf8'), previous)
  vi.mocked(fetch).mockResolvedValueOnce(new Response(feed('Updated')))
  const result = await syncSubscriptions(service)
  assert.equal(result.written, 1)
  const changed = await fs.readFile(file, 'utf8')
  assert.ok(changed.includes('Updated'))
  assert.ok(changed.endsWith('My private meeting notes\n'))
  await fs.writeFile(file, changed.replace('# Updated', '# My own heading'))
  assert.ok((await syncSubscriptions(service)).errors.length)
  assert.match(loadSubscriptions()[0].lastError ?? '', /edited/)
  await fs.writeFile(file, changed)
  await settings([])
  assert.equal((await syncSubscriptions(service)).removed, 0)
  assert.equal(await fs.readFile(file, 'utf8'), changed, 'unsubscribing cannot erase user-authored notes')
})

test('removing the last subscription cleans only owned unchanged notes and stale roots cannot write into another vault', async () => {
  await syncSubscriptions(service)
  const file = await imported()
  const personal = path.join(root, 'Calendar/Sync', 'personal--12345678--2026-09-15.md')
  await fs.writeFile(personal, 'mine')
  await settings([])
  assert.equal((await syncSubscriptions(service)).removed, 1)
  await assert.rejects(fs.access(file))
  assert.equal(await fs.readFile(personal, 'utf8'), 'mine')
  await settings()
  let release!: (value: Response) => void
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        release = resolve
      })
  )
  const pending = syncSubscriptions(service)
  await vi.waitFor(() => assert.ok(release))
  const other = path.join(environment.root, 'other')
  await fs.mkdir(other)
  await service.open(other)
  await vi.waitFor(() => assert.equal(service.info().indexing, false))
  const before = await fs.readdir(other, { recursive: true })
  release(new Response(feed('Must not land in other vault')))
  assert.ok((await pending).errors.length)
  assert.deepEqual(await fs.readdir(other, { recursive: true }), before)
})

test('a legacy imported note is adopted in place and its appended memo survives the first new sync', async () => {
  const { createHash } = await import('node:crypto')
  const date = new Date().toISOString().slice(0, 10)
  const uid = createHash('sha1').update('stable').digest('hex').slice(0, 8)
  const rel = `Calendar/Sync/Original--${uid}--${date}.md`
  const legacy = `---\ntitle: "Original"\ndate: ${date}\nsource: "Test calendar"\nics_uid: "stable"\n---\n# Original\n`
  const created = await service.createNote(rel, root)
  await service.write(rel, `${legacy}My memo\n`, created.mtimeMs, created.content, root)
  await vi.waitFor(() => assert.ok(service.list().some(note => note.path === rel)))
  vi.mocked(fetch).mockResolvedValueOnce(new Response(feed('Renamed')))
  const result = await syncSubscriptions(service)
  assert.equal(result.errors.length, 0)
  const changed = await fs.readFile(path.join(root, rel), 'utf8')
  assert.ok(changed.includes('Renamed'))
  assert.ok(changed.endsWith('My memo\n'))

  const notes = (await fs.readdir(path.join(root, 'Calendar/Sync'), { recursive: true })).filter(file =>
    file.endsWith('.md')
  )

  assert.equal(notes.length, 1, 'migration must not duplicate the event')
})

test('the same feed in a second local subscription record reuses its shared-vault event file', async () => {
  await syncSubscriptions(service)
  const file = await imported()
  await fs.appendFile(file, 'Memo from the first Mac\n')
  // Another installation has its own subscription UUID and no local manifest.
  const stateDir = path.join(environment.root, 'userData')

  for (const filename of await fs.readdir(stateDir)) {
    if (filename.startsWith('calendar-sync-')) {await fs.rm(path.join(stateDir, filename))}
  }

  await settings([{ ...subscription, id: 'another-local-record' }])
  const result = await syncSubscriptions(service)
  assert.equal(result.errors.length, 0)
  assert.ok((await fs.readFile(file, 'utf8')).endsWith('Memo from the first Mac\n'))

  const notes = (await fs.readdir(path.join(root, 'Calendar/Sync'), { recursive: true })).filter(file =>
    file.endsWith('.md')
  )

  assert.equal(notes.length, 1)
})
