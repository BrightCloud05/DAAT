import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'vitest'

import { declaredModules, declaredPackages } from '../scripts/stage-agent-source.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..')
const pyproject = () => fs.readFileSync(path.join(REPO_ROOT, 'pyproject.toml'), 'utf8')

test('declaredModules reads every root module pyproject declares', () => {
  const modules = declaredModules(pyproject())

  // The regression this exists for: the list used to be hard-coded in the
  // staging script, drifted to two of fourteen, and the bundle shipped an agent
  // that died on `No module named 'hermes_constants'` on first launch.
  assert.ok(modules.includes('hermes_constants.py'))
  assert.ok(modules.includes('cli.py'))
  assert.ok(modules.length >= 14, `expected the full module list, got ${modules.length}`)
})

test('every module the bundle promises to ship is actually in the repo', () => {
  for (const file of declaredModules(pyproject())) {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, file)), `pyproject declares ${file} but it is not in the repo`)
  }
})

test('declaredPackages drops the wildcard duplicates', () => {
  const packages = declaredPackages(pyproject())

  assert.ok(packages.includes('agent'))
  // "agent" and "agent.*" name the same directory; copying it twice is wasted
  // work, and copying "agent.*" literally would copy nothing.
  assert.ok(!packages.some(name => name.includes('*')))
  assert.equal(new Set(packages).size, packages.length)
})

test('a module missing from the repo is a build failure, not a silent omission', () => {
  assert.throws(
    () => declaredModules('[tool.setuptools]\nzip-safe = false\n'),
    /could not read .* py-modules/,
    'pyproject without py-modules must fail loudly — shipping a bundle with no root modules is worse'
  )
})
