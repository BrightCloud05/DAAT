import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { strToU8, zipSync } from 'fflate'
import { test } from 'vitest'

import { refreshReleasedRuntime } from './agent-release'
import { computeBundleId, refreshAgentSource, writeStamp } from './agent-source'

async function fixture(change: 'ok' | 'checksum' | 'escape' | 'incompatible' | 'validation' = 'ok') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daat-release-test-'))
  const installed = path.join(root, 'installed'), bundle = path.join(root, 'bundle'), home = path.join(root, 'home')
  const initial = { 'pyproject.toml': 'same', 'uv.lock': 'same', 'core.py': 'old' }
  for (const dir of [installed, bundle]) {
    fs.mkdirSync(dir)
    for (const [name, content] of Object.entries(initial)) {fs.writeFileSync(path.join(dir, name), content)}
  }
  fs.mkdirSync(home)
  fs.writeFileSync(path.join(home, 'config.yaml'), 'model: selected-subscription-model\n')
  writeStamp(installed, computeBundleId(bundle))
  const revision = 'a'.repeat(40), tag = `daat-runtime-${revision}`
  const archive = Buffer.from(zipSync(Object.fromEntries(Object.entries({
    ...initial, 'core.py': 'new', 'plugins/vault/__init__.py': 'vault', 'plugins/memory/vault/__init__.py': 'memory',
    'scripts/verify_daat_runtime.py': 'probe',
    ...(change === 'escape' ? { '../escaped.txt': 'escape' } : {})
  }).map(([name, value]) => [name, strToU8(value)]))))
  const manifest = { format: 1, upstream: 'v2026.9.29', revision, minimumDesktopVersion: change === 'incompatible' ? '9.0.0' : '0.17.0',
    sha256: change === 'checksum' ? '0'.repeat(64) : crypto.createHash('sha256').update(archive).digest('hex'), bytes: archive.length, executables: [] }
  const release = { id: 10, tag_name: tag, draft: false, prerelease: false, assets: ['daat-runtime.json', 'daat-runtime.zip'].map(name => ({
    name, browser_download_url: `https://github.com/BrightCloud05/DAAT/releases/download/${tag}/${name}`
  })) }
  let requests = 0
  const server = http.createServer((req, res) => {
    requests++
    res.end(req.url?.endsWith('.zip') ? archive : JSON.stringify(req.url?.endsWith('.json') ? manifest : [release]))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const options = { installed, bundle, hermesHome: home, desktopVersion: '0.17.0', now: 10_000_000,
    log: () => {}, fetch: ((url: string, opts: RequestInit) => fetch(`http://127.0.0.1:${port}${new URL(url).pathname}`, opts)) as typeof fetch,
    refresh: (target: string, source: string) => refreshAgentSource(target, source, {
      copy: (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to) },
      remove: file => fs.rmSync(file), exists: fs.existsSync,
      prepareRuntime: async () => { if (change === 'validation') {throw new Error('incompatible runtime')} }
    }) }
  return { root, installed, home, options, requests: () => requests, close: async () => {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    fs.rmSync(root, { recursive: true, force: true })
  } }
}

test('a verified release updates the real source transaction and survives restart without downgrade or preference changes', async () => {
  const f = await fixture()
  try {
    assert.equal((await refreshReleasedRuntime(f.options)).action, 'updated')
    assert.equal(fs.readFileSync(path.join(f.installed, 'core.py'), 'utf8'), 'new')
    assert.ok(fs.existsSync(path.join(f.installed, 'plugins/memory/vault/__init__.py')))
    const requests = f.requests()
    assert.equal((await refreshReleasedRuntime(f.options)).action, 'current')
    assert.equal(f.requests(), requests)
    assert.equal(fs.readFileSync(path.join(f.installed, 'core.py'), 'utf8'), 'new')
    assert.equal(fs.readFileSync(path.join(f.home, 'config.yaml'), 'utf8'), 'model: selected-subscription-model\n')
    fs.appendFileSync(path.join(f.home, 'config.yaml'), 'updates:\n  runtime_auto_update: false\n')
    await refreshReleasedRuntime({ ...f.options, now: f.options.now + 24 * 60 * 60_000 })
    assert.equal(f.requests(), requests)
    // A process crash can leave a replacement visible before validation commits.
    const work = fs.mkdtempSync(path.join(f.root, '.installed-update-'))
    fs.cpSync(f.installed, path.join(work, 'previous'), { recursive: true })
    fs.writeFileSync(path.join(f.installed, 'core.py'), 'unvalidated')
    fs.writeFileSync(`${f.installed}.daat-update.json`, JSON.stringify({ version: 1, work, retained: [], committed: false }))
    await refreshReleasedRuntime(f.options)
    assert.equal(fs.readFileSync(path.join(f.installed, 'core.py'), 'utf8'), 'new')
    assert.equal(fs.existsSync(`${f.installed}.daat-update.json`), false)
  } finally {await f.close()}
})

test('untrusted, incompatible and failing updates preserve the usable source and never escape extraction', async () => {
  for (const change of ['checksum', 'escape', 'incompatible', 'validation'] as const) {
    const f = await fixture(change)
    try {
      await refreshReleasedRuntime(f.options)
      assert.equal(fs.readFileSync(path.join(f.installed, 'core.py'), 'utf8'), 'old', change)
      assert.equal(fs.existsSync(path.join(f.home, 'runtime-updates', 'escaped.txt')), false)
      assert.equal(fs.existsSync(path.join(f.installed, '.daat-runtime-release.json')), false)
    } finally {await f.close()}
  }
  const f = await fixture()
  try {
    await assert.rejects(refreshReleasedRuntime({ ...f.options, refresh: async (_target, source) => {
      if (source === f.options.bundle) {return { action: 'current' }}
      throw new Error('Agent update recovery failed')
    } }), /recovery failed/)
  } finally {await f.close()}
})
