import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'vitest'
import { removeOtherPlatformPayloads } from './stage-native-deps.mjs'

test('switching targets removes old native payloads while retaining the selected payload and shared packages', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daat-payloads-'))
  const host = '@parcel/watcher-darwin-arm64'
  const target = '@parcel/watcher-win32-x64'
  const shared = '@parcel/watcher'
  try {
    for (const name of [host, target, shared]) {
      fs.mkdirSync(path.join(root, name), { recursive: true })
      fs.writeFileSync(path.join(root, name, 'payload'), name)
    }
    removeOtherPlatformPayloads(root, [host, target], target)
    assert.equal(fs.existsSync(path.join(root, host)), false)
    for (const name of [target, shared]) {
      assert.equal(fs.readFileSync(path.join(root, name, 'payload'), 'utf8'), name)
    }
    // Repeating the same build must also succeed when stale payloads are gone.
    removeOtherPlatformPayloads(root, [host, target], target)
    assert.equal(fs.existsSync(path.join(root, target)), true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
