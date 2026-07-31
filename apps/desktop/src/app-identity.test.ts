/**
 * The app must call itself Daat everywhere a user can read it.
 *
 * The rename left one survivor that nothing checked: `index.html` still said
 * `<title>Hermes</title>`, which is the macOS window title and the entry in
 * the Window menu. Every other surface — Dock, About panel, app menu — was
 * already correct, which is exactly why it went unnoticed.
 *
 * Internal identifiers are deliberately NOT covered here. `HERMES_HOME`, the
 * `hermes:*` IPC channels, `window.hermesDesktop` and the
 * `X-Hermes-Session-Token` header are wire contracts shared with the Python
 * backend; renaming them breaks the app without changing a single pixel.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'vitest'

const DESKTOP = path.resolve(import.meta.dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP, 'package.json'), 'utf8'))

test('the window title is the product name', () => {
  const html = fs.readFileSync(path.join(DESKTOP, 'index.html'), 'utf8')
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1]

  assert.equal(title, 'Daat')
})

test('the package and the build config agree on the product name', () => {
  assert.equal(pkg.productName, 'Daat')
  assert.equal(pkg.build?.productName, 'Daat')
})

test('the bundle identifier is ours, not upstream', () => {
  const appId = pkg.build?.appId ?? ''

  assert.ok(appId.length > 0, 'appId must be set or macOS falls back to a generated one')
  assert.ok(!/nous|hermes/i.test(appId), `appId still references upstream: ${appId}`)
})

test('the deep-link scheme is ours', () => {
  const schemes = (pkg.build?.protocols ?? []).flatMap((protocol: { schemes?: string[] }) => protocol.schemes ?? [])

  for (const scheme of schemes) {
    assert.ok(!/hermes/i.test(scheme), `deep-link scheme still upstream: ${scheme}`)
  }
})
