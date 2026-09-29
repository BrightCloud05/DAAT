/**
 * Updating someone's install directory is the one operation here with no undo.
 *
 * The rules it has to keep: never touch a git checkout, never touch an install
 * of unknown origin, never touch one the user has edited, and never take the
 * venv down with it — that costs minutes to rebuild and the user did not ask
 * for it.
 */

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, test } from 'vitest'

import {
  BUNDLE_ID_NAME,
  bundleFingerprint,
  computeBundleId,
  locallyModified,
  ownedFiles,
  readStamp,
  recoverAgentSource,
  refreshAgentSource,
  STAMP_NAME,
  writeStamp
} from './agent-source'

const temps: string[] = []

const tree = (files: Record<string, string>) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-src-'))

  temps.push(root)

  for (const [rel, body] of Object.entries(files)) {
    const target = path.join(root, rel)

    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, body, 'utf8')
  }

  return root
}

const read = (root: string, rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')

afterEach(async () => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true })
  }
})

test('an untouched install is brought up to date', async () => {
  const installed = tree({ 'cli.py': 'old', 'agent/core.py': 'old core' })

  writeStamp(installed, computeBundleId(installed))

  const bundle = tree({ 'cli.py': 'new', 'agent/core.py': 'new core' })
  const result = await refreshAgentSource(installed, bundle)

  assert.equal(result.action, 'updated')
  assert.equal(read(installed, 'cli.py'), 'new')
  assert.equal(read(installed, 'agent/core.py'), 'new core')
})

test('the venv survives, because rebuilding it costs minutes', async () => {
  const installed = tree({ 'cli.py': 'old', 'venv/bin/python': 'binary', 'venv/lib/thing.py': 'dep' })

  writeStamp(installed, computeBundleId(installed))
  await refreshAgentSource(installed, tree({ 'cli.py': 'new' }))

  assert.equal(read(installed, 'venv/bin/python'), 'binary')
  assert.equal(read(installed, 'venv/lib/thing.py'), 'dep')
})

test("anything the user put there themselves stays", async () => {
  const installed = tree({ 'cli.py': 'old' })

  writeStamp(installed, computeBundleId(installed))
  fs.writeFileSync(path.join(installed, 'my-notes.txt'), 'mine', 'utf8')
  fs.writeFileSync(path.join(installed, '.install_method'), 'git', 'utf8')

  await refreshAgentSource(installed, tree({ 'cli.py': 'new' }))

  assert.equal(read(installed, 'my-notes.txt'), 'mine')
  assert.equal(read(installed, '.install_method'), 'git')
})

test('a module the new bundle dropped is removed, not left to shadow', async () => {
  const installed = tree({ 'cli.py': 'old', 'gone.py': 'deleted upstream' })

  writeStamp(installed, computeBundleId(installed))

  const result = await refreshAgentSource(installed, tree({ 'cli.py': 'new' }))

  assert.equal(result.action === 'updated' && result.removed, 1)
  assert.equal(fs.existsSync(path.join(installed, 'gone.py')), false)
})

test('a git checkout is never touched', async () => {
  const installed = tree({ 'cli.py': 'mine', '.git/HEAD': 'ref: refs/heads/main' })

  writeStamp(installed, computeBundleId(installed))

  const result = await refreshAgentSource(installed, tree({ 'cli.py': 'new' }))

  assert.equal(result.action, 'declined')
  assert.equal(result.action === 'declined' && result.why, 'git-checkout')
  assert.equal(read(installed, 'cli.py'), 'mine')
})

test('an install with no stamp is left alone — its origin is unknown', async () => {
  // Someone who set the agent up by hand, or an install from before stamps
  // existed. Replacing it would be deleting work nobody asked us to delete.
  const installed = tree({ 'cli.py': 'hand-made' })
  const result = await refreshAgentSource(installed, tree({ 'cli.py': 'new' }))

  assert.equal(result.action === 'declined' && result.why, 'no-stamp')
  assert.equal(read(installed, 'cli.py'), 'hand-made')
})

test('an edited file stops the whole update, and says which', async () => {
  const installed = tree({ 'cli.py': 'old', 'agent/core.py': 'old core' })

  writeStamp(installed, computeBundleId(installed))
  // A user who patched something is telling us they want their version.
  fs.writeFileSync(path.join(installed, 'agent/core.py'), 'my patch', 'utf8')

  const result = await refreshAgentSource(installed, tree({ 'cli.py': 'new', 'agent/core.py': 'new core' }))

  assert.equal(result.action === 'declined' && result.why, 'locally-modified')
  assert.match(result.action === 'declined' ? result.detail : '', /agent\/core\.py/)
  assert.equal(read(installed, 'agent/core.py'), 'my patch')
  assert.equal(read(installed, 'cli.py'), 'old', 'and nothing else is half-updated either')
})

test('a deleted file counts as modified', async () => {
  const installed = tree({ 'cli.py': 'old', 'agent/core.py': 'old core' })

  writeStamp(installed, computeBundleId(installed))
  fs.rmSync(path.join(installed, 'agent/core.py'))

  const result = await refreshAgentSource(installed, tree({ 'cli.py': 'new' }))

  assert.equal(result.action === 'declined' && result.why, 'locally-modified')
})

test('nothing installed and nothing bundled are both non-events', async () => {
  const real = tree({ 'cli.py': 'x' })

  assert.equal((await refreshAgentSource(real, path.join(real, 'nope'))).action, 'unavailable')
  assert.equal((await refreshAgentSource(path.join(real, 'nope'), real)).action, 'unavailable')
})

test('the stamp ignores the venv and the caches', async () => {
  const root = tree({
    'cli.py': 'x',
    'venv/bin/python': 'binary',
    '__pycache__/cli.cpython-311.pyc': 'bytes',
    'agent/__pycache__/x.pyc': 'bytes'
  })

  assert.deepEqual(ownedFiles(root), ['cli.py'])
})

test('the stamp round-trips and reports an untouched tree as clean', async () => {
  const root = tree({ 'cli.py': 'x', 'a/b.py': 'y' })
  const stamp = writeStamp(root, computeBundleId(root))

  assert.equal(readStamp(root)?.bundle, computeBundleId(root))
  assert.deepEqual(locallyModified(root, stamp), [])
})

test('the stamp file does not describe itself', async () => {
  // Writing the stamp changes the directory; if it listed itself every install
  // would look modified one moment after being written.
  const root = tree({ 'cli.py': 'x' })
  const stamp = writeStamp(root, computeBundleId(root))

  assert.equal(Object.keys(stamp.files).includes(STAMP_NAME), false)
  assert.deepEqual(locallyModified(root, stamp), [])
})

test('an identical bundle is a no-op, without reading a single file', async () => {
  // The common path: every launch after an update lands here.
  const installed = tree({ 'cli.py': 'same', 'agent/core.py': 'same core' })
  const bundle = tree({ 'cli.py': 'same', 'agent/core.py': 'same core' })

  // The real build always writes this; without it a launch falls back to sizes.
  fs.writeFileSync(path.join(bundle, BUNDLE_ID_NAME), computeBundleId(bundle), 'utf8')
  writeStamp(installed, computeBundleId(bundle))

  assert.equal((await refreshAgentSource(installed, bundle)).action, 'current')
})

test('a changed lockfile is flagged, because the venv no longer matches', async () => {
  // Source alone can be swapped in place; a dependency change means the
  // installed packages are wrong and the caller has to re-run the deps stage.
  const installed = tree({ 'cli.py': 'old', 'uv.lock': 'lock v1' })

  writeStamp(installed, 'older-bundle')

  const result = await refreshAgentSource(installed, tree({ 'cli.py': 'new', 'uv.lock': 'lock v2' }), { copy: fs.copyFileSync, remove: target => fs.rmSync(target, { force: true }), exists: fs.existsSync, prepareRuntime: async () => undefined })

  assert.equal(result.action === 'updated' && result.depsChanged, true)
})

test('source-only changes do not claim the venv is stale', async () => {
  const installed = tree({ 'cli.py': 'old', 'uv.lock': 'lock v1' })

  writeStamp(installed, 'older-bundle')

  const result = await refreshAgentSource(installed, tree({ 'cli.py': 'new', 'uv.lock': 'lock v1' }))

  assert.equal(result.action === 'updated' && result.depsChanged, false)
})

test('the stamp is rewritten after an update, so the next launch is a no-op', async () => {
  const installed = tree({ 'cli.py': 'old' })

  writeStamp(installed, 'older-bundle')

  const bundle = tree({ 'cli.py': 'new' })

  assert.equal((await refreshAgentSource(installed, bundle)).action, 'updated')
  assert.equal((await refreshAgentSource(installed, bundle)).action, 'current')
})

test('the build writes an exact id, and a launch just reads it', async () => {
  // Sizes alone would call these two trees identical — same paths, same byte
  // counts — and an update that skipped a fix like 1500 -> 9000 would be
  // invisible. The id is computed from contents at build time for exactly this.
  const before = tree({ 'timeout.py': 'WAIT = 1500' })
  const after = tree({ 'timeout.py': 'WAIT = 9000' })

  assert.notEqual(computeBundleId(before), computeBundleId(after))

  fs.writeFileSync(path.join(after, BUNDLE_ID_NAME), computeBundleId(after), 'utf8')
  assert.equal(bundleFingerprint(after), computeBundleId(after), 'a launch reads the declared id')
})

test('a same-size edit is still caught as an update', async () => {
  const installed = tree({ 'timeout.py': 'WAIT = 1500' })

  writeStamp(installed, computeBundleId(installed))

  const bundle = tree({ 'timeout.py': 'WAIT = 9000' })

  fs.writeFileSync(path.join(bundle, BUNDLE_ID_NAME), computeBundleId(bundle), 'utf8')

  const result = await refreshAgentSource(installed, bundle)

  assert.equal(result.action, 'updated')
  assert.equal(read(installed, 'timeout.py'), 'WAIT = 9000')
})

test('successive updates preserve unowned files and refuse incoming name collisions', async () => {
  const installed = tree({ 'cli.py': 'v1' })
  writeStamp(installed, computeBundleId(installed))
  fs.writeFileSync(path.join(installed, 'my-notes.txt'), 'mine')
  fs.writeFileSync(path.join(installed, '.hermes-bootstrap-complete'), 'marker')
  await refreshAgentSource(installed, tree({ 'cli.py': 'v2' }))
  await refreshAgentSource(installed, tree({ 'cli.py': 'v3' }))
  assert.equal(read(installed, 'my-notes.txt'), 'mine')
  assert.equal(read(installed, '.hermes-bootstrap-complete'), 'marker')
  assert.equal('my-notes.txt' in readStamp(installed)!.files, false)
  const collision = await refreshAgentSource(installed, tree({ 'cli.py': 'v4', 'my-notes.txt': 'replacement' }))
  assert.equal(collision.action, 'declined')
  assert.equal(read(installed, 'my-notes.txt'), 'mine')
  assert.equal(read(installed, 'cli.py'), 'v3')
})

test('runtime failure restores both source and dependencies, and retry can succeed', async () => {
  const installed = tree({ 'cli.py': 'old', 'uv.lock': 'old lock', 'venv/sentinel': 'old environment', '.venv/sentinel': 'personal environment' })
  writeStamp(installed, computeBundleId(installed))
  const originalStamp = read(installed, STAMP_NAME)
  const bundle = tree({ 'cli.py': 'new', 'uv.lock': 'new lock' })

  const deps = {
    copy: (from: string, to: string) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to) },
    remove: (target: string) => fs.rmSync(target, { force: true }), exists: fs.existsSync,
    prepareRuntime: async ({ installed: target }: { installed: string }) => {
      fs.mkdirSync(path.join(target, 'venv'), { recursive: true })
      fs.writeFileSync(path.join(target, 'venv/sentinel'), 'new environment')
      throw new Error('new dependency failed validation')
    }
  }

  assert.equal((await refreshAgentSource(installed, bundle, deps)).action, 'failed')
  assert.equal(read(installed, 'cli.py'), 'old')
  assert.equal(read(installed, 'venv/sentinel'), 'old environment')
  assert.equal(read(installed, STAMP_NAME), originalStamp)

  const success = await refreshAgentSource(installed, bundle, {
    ...deps, prepareRuntime: async ({ installed: target }) => {
      fs.mkdirSync(path.join(target, 'venv'), { recursive: true })
      fs.writeFileSync(path.join(target, 'venv/sentinel'), 'verified environment')
    }
  })

  assert.equal(success.action, 'updated')
  assert.equal(read(installed, 'venv/sentinel'), 'verified environment')
  assert.equal(read(installed, '.venv/sentinel'), 'personal environment')
})

test('interrupted validation recovers the previous sources, dependencies and user files', async () => {
  const installed = tree({ 'cli.py': 'old', 'uv.lock': 'old lock', 'venv/sentinel': 'old environment' })
  writeStamp(installed, computeBundleId(installed))
  fs.writeFileSync(path.join(installed, 'personal.txt'), 'mine')
  const bundle = tree({ 'cli.py': 'new', 'uv.lock': 'new lock' })
  const module = new URL('./agent-source.ts', import.meta.url).href

  const code = `
    import fs from 'node:fs';
    import path from 'node:path';
    import { refreshAgentSource } from ${JSON.stringify(module)};
    await refreshAgentSource(${JSON.stringify(installed)}, ${JSON.stringify(bundle)}, {
      copy: (from, to) => { fs.mkdirSync(path.dirname(to), {recursive: true}); fs.copyFileSync(from, to) },
      remove: target => fs.rmSync(target, {force: true}), exists: fs.existsSync,
      prepareRuntime: async ({installed}) => {
        fs.mkdirSync(path.join(installed, 'venv'), {recursive: true});
        fs.writeFileSync(path.join(installed, 'venv/sentinel'), 'unfinished environment');
        process.send('validating');
        await new Promise(resolve => setTimeout(resolve, 30000));
      }
    });`

  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })

  try {
    const ready = await Promise.race([
      once(child, 'message'),
      once(child, 'exit').then(([code]) => { throw new Error(`Update process exited before validation: ${code}`) })
    ])

    assert.equal(ready[0], 'validating')
    const exited = once(child, 'exit')
    child.kill('SIGKILL')
    await exited
    assert.equal(recoverAgentSource(installed), true)
    assert.equal(read(installed, 'cli.py'), 'old')
    assert.equal(read(installed, 'venv/sentinel'), 'old environment')
    assert.equal(read(installed, 'personal.txt'), 'mine')
    assert.deepEqual(locallyModified(installed, readStamp(installed)!), [])
  } finally {
    if (child.exitCode === null && child.signalCode === null) {child.kill()}
    fs.rmSync(`${installed}.daat-update.lock`, {force: true})
  }
})

test('legacy polluted ownership is migrated without deleting ambiguous user files', async () => {
  const installed = tree({ 'cli.py': 'old', 'personal.txt': 'mine' })
  const stamp = writeStamp(installed, computeBundleId(installed))
  fs.writeFileSync(path.join(installed, STAMP_NAME), JSON.stringify({ ...stamp, version: 1 }))
  await refreshAgentSource(installed, tree({ 'cli.py': 'new' }))
  await refreshAgentSource(installed, tree({ 'cli.py': 'newer' }))
  assert.equal(read(installed, 'personal.txt'), 'mine')
})


test('an interrupted matching bundle is completed without claiming user files', async () => {
  const bundle = tree({ 'cli.py': 'bundled', 'agent/core.py': 'core' })
  const id = computeBundleId(bundle)
  fs.writeFileSync(path.join(bundle, BUNDLE_ID_NAME), id)
  const installed = tree({ [BUNDLE_ID_NAME]: id, 'cli.py': 'bundled', 'notes.txt': 'mine', 'venv/keep': 'environment' })
  const result = await refreshAgentSource(installed, bundle)
  assert.equal(result.action, 'seeded')
  assert.equal(read(installed, 'agent/core.py'), 'core')
  assert.equal(read(installed, 'notes.txt'), 'mine')
  assert.equal(read(installed, 'venv/keep'), 'environment')
  assert.deepEqual(Object.keys(readStamp(installed)!.files).sort(), ownedFiles(bundle))
  assert.equal((await refreshAgentSource(installed, bundle)).action, 'current')
})

test('missing-stamp recovery refuses edited files and linked paths before writing', async () => {
  const bundle = tree({ 'cli.py': 'bundled', 'agent/core.py': 'core' })
  const id = computeBundleId(bundle)
  fs.writeFileSync(path.join(bundle, BUNDLE_ID_NAME), id)
  for (const linked of [false, true]) {
    const installed = tree({ [BUNDLE_ID_NAME]: id, 'cli.py': linked ? 'bundled' : 'my edit' })
    const external = tree({ 'core.py': 'core' })
    if (linked) fs.symlinkSync(external, path.join(installed, 'agent'), process.platform === 'win32' ? 'junction' : 'dir')
    const result = await refreshAgentSource(installed, bundle)
    assert.equal(result.action, 'declined')
    assert.equal(readStamp(installed), null)
    assert.equal(read(installed, 'cli.py'), linked ? 'bundled' : 'my edit')
    if (!linked) assert.equal(fs.existsSync(path.join(installed, 'agent')), false)
    assert.equal(read(external, 'core.py'), 'core')
  }
})
