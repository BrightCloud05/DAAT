import assert from 'node:assert/strict'
import { test } from 'vitest'
import { canReuseHostElectron } from './electron-dist-target.mjs'

test('keeps the local Electron workaround for builds confined to the host', () => {
  for (const argv of [[], ['--dir'], ['--mac', 'dmg', '--arm64'], ['-m', 'zip:arm64']]) {
    assert.equal(canReuseHostElectron(argv, 'darwin', 'arm64'), true, argv.join(' '))
  }
  assert.equal(canReuseHostElectron(['--win', 'nsis', '--x64'], 'win32', 'x64'), true)
})

test('foreign or mixed targets never reuse the host Electron runtime', () => {
  for (const argv of [
    ['--win', 'nsis', '--x64'], ['-w', 'nsis'], ['--windows=nsis'],
    ['--linux'], ['--mac', '--win'], ['-mw'], ['--mac', '--x64'],
    ['--mac', '--arm64', '--x64'], ['--mac', 'zip:x64'], ['--universal'],
    ['--config', 'custom.yml'], ['-c.mac.target=zip'], ['-c.electronDist=/custom/runtime']
  ]) {
    assert.equal(canReuseHostElectron(argv, 'darwin', 'arm64'), false, argv.join(' '))
  }
})
