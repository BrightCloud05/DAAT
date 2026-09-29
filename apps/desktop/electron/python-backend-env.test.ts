import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, test } from 'vitest'

import { buildPythonBackendEnv } from './python-backend-env'

const roots: string[] = []

function tree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daat-python-env-'))
  roots.push(root)

  for (const [name, version] of [['.venv', '3.11'], ['venv', '3.12']]) {
    const env = path.join(root, name)
    fs.mkdirSync(path.join(env, process.platform === 'win32' ? 'Scripts' : 'bin'), { recursive: true })
    fs.mkdirSync(path.join(env, process.platform === 'win32' ? 'Lib/site-packages' : `lib/python${version}/site-packages`), { recursive: true })
    fs.writeFileSync(path.join(env, 'pyvenv.cfg'), `version_info = ${version}.0.final.0\n`)
  }

  return root
}

afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })))

test('coexisting venvs use libraries and PATH from the selected interpreter only', () => {
  const root = tree()
  const selected = path.join(root, '.venv')
  const bin = process.platform === 'win32' ? 'Scripts' : 'bin'
  const python = path.join(selected, bin, process.platform === 'win32' ? 'python.exe' : 'python')
  const env = buildPythonBackendEnv(root, python, { currentEnv: {} })
  const entries = env.PYTHONPATH.split(path.delimiter)
  assert.equal(entries[0], root)
  assert.ok(entries.some(entry => entry.startsWith(selected + path.sep)))
  assert.ok(entries.every(entry => !entry.startsWith(path.join(root, 'venv') + path.sep)))
  assert.equal(env.PATH.split(path.delimiter)[0], path.join(selected, bin))
})

test('an explicit standalone interpreter does not borrow a sibling virtual environment', () => {
  const root = tree()
  const python = path.join(root, 'standalone', 'python')
  const env = buildPythonBackendEnv(root, python, { currentEnv: {} })
  assert.equal(env.PYTHONPATH, root)
  assert.ok(!env.PATH.includes(path.join(root, 'venv')))
  assert.ok(!env.PATH.includes(path.join(root, '.venv')))
})
