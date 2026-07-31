/**
 * The shipped Content-Security-Policy.
 *
 * The renderer holds `window.hermesDesktop` — vault read/write, mail send, the
 * whole IPC surface — and page JS reaches it by design. So a script that gets
 * into this document owns every note the user has. The policy is what makes
 * injected markup inert.
 *
 * These assertions are about the directives that would matter on the day
 * something goes wrong. A policy weakened by one convenient keyword looks fine
 * in review and stops working entirely, so the weakenings are named and
 * asserted against by name.
 *
 * Verified against the real renderer when it was written: an injected inline
 * script did not run, a remote image did not load, eval() threw, a fetch to a
 * remote origin failed, and framing a remote page was refused with a
 * frame-src violation. Every screen was walked with the policy enforcing and
 * produced zero violations.
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const builtIndex = resolve(root, 'dist/index.html')

function policy(): string {
  assert.ok(existsSync(builtIndex), 'dist/index.html is missing — run `npm run build` first')

  const html = readFileSync(builtIndex, 'utf8')
  const found = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)

  assert.ok(found, 'the built index.html carries no Content-Security-Policy')

  return found[1]
}

function directive(name: string): string {
  const match = new RegExp(`(?:^|;\\s*)${name} ([^;]*)`).exec(policy())

  assert.ok(match, `the policy has no ${name} directive`)

  return match[1].trim()
}

test('the build ships a policy at all', () => {
  assert.ok(policy().includes("default-src 'none'"), 'the policy must start from deny-all')
})

test('scripts come only from the bundle', () => {
  const value = directive('script-src')

  assert.ok(value.includes("'self'"))
  assert.ok(
    !value.includes("'unsafe-inline'"),
    "'unsafe-inline' in script-src allows every injected <script> — the exact thing this policy is for"
  )
  assert.ok(!value.includes("'unsafe-eval'"), "'unsafe-eval' re-opens string-to-code execution")
  assert.ok(!/https?:/.test(value), 'no remote script origin may be trusted')
})

test('the one inline script is allowed by hash, not by keyword', () => {
  // index.html paints the themed background before the bundle loads. Allowing
  // it with a keyword would allow every other inline script too.
  assert.match(directive('script-src'), /'sha256-[A-Za-z0-9+/]+='/)
})

test('the hash matches what actually ships', () => {
  // A stale hash fails closed — the anti-flash script silently stops running
  // and every window opens white. Recompute it from the built file.
  const html = readFileSync(builtIndex, 'utf8')
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]

  assert.ok(inline.length > 0, 'expected at least one inline script to hash')

  for (const [, body] of inline) {
    const digest = execFileSync('openssl', ['dgst', '-sha256', '-binary'], { input: body })
    const hash = `'sha256-${digest.toString('base64')}'`

    assert.ok(directive('script-src').includes(hash), `an inline script is not covered by the policy: ${hash}`)
  }
})

test('nothing remote can be loaded or reached', () => {
  // A remote image in a note or an email is a read receipt; a remote fetch is
  // an exfiltration channel. Both stay local.
  for (const name of ['img-src', 'font-src', 'media-src', 'connect-src']) {
    const value = directive(name)

    assert.ok(
      !/https?:\/\/(?!127\.0\.0\.1|localhost)/.test(value),
      `${name} allows a remote origin: ${value}`
    )
  }
})

test('the agent gateway is still reachable', () => {
  // Deny-all is only correct if the app still works. The gateway is local.
  const value = directive('connect-src')

  assert.ok(/ws:\/\/(127\.0\.0\.1|localhost)/.test(value), 'the local gateway websocket must be allowed')
})

test('plugins, frames and form posts are refused outright', () => {
  assert.equal(directive('object-src'), "'none'")
  assert.equal(directive('frame-src'), "'none'")
  assert.equal(directive('base-uri'), "'none'", 'a <base> tag would re-point every relative URL')
  assert.equal(directive('form-action'), "'none'")
})

test('style-src is the one deliberate weakening, and only that one', () => {
  // React sets style props inline by construction, so this cannot be closed.
  // Style injection cannot execute code; it can exfiltrate via url(), which is
  // why the fetching directives above stay local.
  const value = directive('style-src')

  assert.ok(value.includes("'unsafe-inline'"))
  assert.ok(!value.includes("'unsafe-eval'"))
})
