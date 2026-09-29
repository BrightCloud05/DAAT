/**
 * Where Daat's agent stands.
 *
 * The agent's working directory is not just where its tools resolve paths — it
 * is written into the system prompt (agent/system_prompt.py, resolve_context_cwd).
 * A session rooted at the home folder therefore hands the model the string
 * `/Users/example`, and the model does the obvious thing with it: the very first
 * message on a freshly installed Mac greeted the user as Joseph. Nothing was
 * hardcoded. It read the path.
 *
 * Rooting Daat's sessions in the vault fixes that and does something better: an
 * agent standing in the vault is standing in the user's notes, which is the
 * whole premise of the product.
 *
 * This atom lives in the store layer, not next to the vault, so `projects.ts`
 * can read it without importing app code and closing an import cycle. The vault
 * store pushes; nothing here pulls.
 */

import { atom } from 'nanostores'

import { isSimpleMode } from '@/store/ui-mode'

/** Absolute path of the open vault, or '' when none is open yet. */
export const $vaultRoot = atom<string>('')

export function setVaultRoot(root: string): void {
  const next = (root || '').trim()

  if ($vaultRoot.get() !== next) {
    $vaultRoot.set(next)
  }
}

/**
 * The vault, when a new session should start there — otherwise null.
 *
 * Lives here rather than inline in resolveNewSessionCwd so the rule can be
 * tested without standing up the gateway, git and filesystem bridges that
 * importing projects.ts drags in. A test that has to mock all of those is
 * mostly testing its own mocks.
 *
 * Null (not '') means "no opinion": the caller's existing resolution — project
 * scope, then the configured default — still applies. Only Daat is opinionated
 * about this; the developer-facing chat product is untouched.
 */
export function vaultSessionCwd(): string | null {
  const root = $vaultRoot.get()

  return isSimpleMode() && root ? root : null
}
