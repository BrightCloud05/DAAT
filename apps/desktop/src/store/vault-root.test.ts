/**
 * Where a new Daat chat starts.
 *
 * The agent's working directory is not private plumbing: it is written into the
 * system prompt (agent/system_prompt.py → resolve_context_cwd). A session rooted
 * at the home folder hands the model the literal string `/Users/<name>`, and on
 * a freshly installed Mac the model's first message greeted its owner by that
 * name. Nothing was hardcoded — it read the path and drew the obvious
 * conclusion.
 *
 * So this pins the rule: in Daat, a new chat stands in the vault.
 */

import assert from 'node:assert/strict'

import { afterEach, test, vi } from 'vitest'

let simple = true

vi.mock('@/store/ui-mode', () => ({ isSimpleMode: () => simple }))

const { $vaultRoot, setVaultRoot, vaultSessionCwd } = await import('./vault-root')

afterEach(() => {
  simple = true
  setVaultRoot('')
})

test('a new chat starts in the vault, not the home folder', () => {
  setVaultRoot('/Users/somebody/Notes')

  assert.equal(vaultSessionCwd(), '/Users/somebody/Notes')
})

test('with no vault open it has no opinion', () => {
  setVaultRoot('')

  assert.equal(vaultSessionCwd(), null)
})

test('the full chat product is left alone', () => {
  // Only Daat's simple mode is opinionated about this; the developer-facing
  // shell still resolves a project or the configured default.
  simple = false
  setVaultRoot('/Users/somebody/Notes')

  assert.equal(vaultSessionCwd(), null)
})

test('the published root is trimmed and de-duplicated', () => {
  setVaultRoot('  /Users/somebody/Notes  ')
  assert.equal($vaultRoot.get(), '/Users/somebody/Notes')

  let notified = 0

  const stop = $vaultRoot.subscribe(() => {
    notified += 1
  })

  setVaultRoot('/Users/somebody/Notes')
  stop()

  // subscribe() fires once immediately; setting the same value must not add to
  // it, or every vault refresh would restart sessions' idea of where they are.
  assert.equal(notified, 1)
})
