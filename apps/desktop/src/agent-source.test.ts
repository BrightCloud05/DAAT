/**
 * The agent source that ships inside the app bundle.
 *
 * A packaged install used to clone the repo and then build ~2.4 GB into
 * ~/.daat, of which 1.3 GB was `node_modules` for rebuilding the renderer the
 * app already contains. Shipping the Python source removes the clone — which
 * also removes the requirement that the repository be public, since an
 * anonymous clone cannot reach a private one.
 *
 * The failure mode this guards is specific and nasty: a package that
 * pyproject declares but the bundle omits does not fail the build, does not
 * fail here on a dev machine with a full checkout, and surfaces as an
 * ImportError the first time a stranger launches the app.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'vitest'

// The staging script is plain JS by design (it runs before any build step).
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error -- untyped build script
import { declaredPackages } from '../scripts/stage-agent-source.mjs'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(desktopRoot, '../..')
const staged = join(desktopRoot, 'dist/agent-src')

const pyproject = () => readFileSync(join(repoRoot, 'pyproject.toml'), 'utf8')

test('the package list is read from pyproject, not hard-coded', () => {
  const packages = declaredPackages(pyproject())

  assert.ok(packages.includes('hermes_cli'))
  assert.ok(packages.includes('agent'))
  assert.ok(packages.includes('plugins'))
  assert.ok(!packages.some((name: string) => name.includes('*')), 'glob forms are the same directory')
})

test('a pyproject without the include list fails loudly', () => {
  // Silently staging nothing would ship an app that cannot import itself.
  assert.throws(() => declaredPackages('[project]\nname = "x"\n'), /could not read/)
})

test.skipIf(!existsSync(staged))('every declared package is in the bundle', () => {
  const missing = declaredPackages(pyproject()).filter((name: string) => !existsSync(join(staged, name)))

  assert.deepEqual(missing, [], `these would be an ImportError on a user's machine: ${missing.join(', ')}`)
})

test.skipIf(!existsSync(staged))('the bundle satisfies the installer’s own seeded-checkout check', () => {
  // scripts/install.sh accepts a non-git directory only when both of these are
  // present; without them it exits with "not a git repository".
  assert.ok(existsSync(join(staged, 'pyproject.toml')))
  assert.ok(existsSync(join(staged, 'hermes_cli')))
})

test.skipIf(!existsSync(staged))('the bundle carries the installer it will be asked to run', () => {
  assert.ok(existsSync(join(staged, 'scripts', 'install.sh')))
})

test.skipIf(!existsSync(staged))('`hermes serve` is present, since that is all the app runs', () => {
  // electron/main.ts probes dashboard.py to decide whether `serve` exists.
  const dashboard = join(staged, 'hermes_cli', 'subcommands', 'dashboard.py')

  assert.ok(existsSync(dashboard))
  assert.match(readFileSync(dashboard, 'utf8'), /serve/)
})

test.skipIf(!existsSync(staged))('no build junk or virtualenv is shipped to users', () => {
  for (const junk of ['node_modules', '.git', 'venv', '.venv', '__pycache__']) {
    assert.ok(!existsSync(join(staged, junk)), `${junk} must not ship`)
  }
})
