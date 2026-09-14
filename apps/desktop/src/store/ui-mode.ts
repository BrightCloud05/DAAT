/**
 * UI mode: 'simple' (default) hides developer-oriented surfaces so the app
 * reads as a notes + assistant product for non-technical users; 'advanced'
 * restores the full toolbox (messaging, artifacts, skills hub, terminal-era
 * chrome).
 *
 * Read synchronously at module load because contribution registration and the
 * default layout tree are decided once at startup — switching modes persists
 * the choice and reloads the window (a deliberate hard boundary, same as a
 * profile change).
 */

import { atom } from 'nanostores'

import { persistString, storedString } from '@/lib/storage'

const KEY = 'daat.desktop.uiMode.v1'

export type UiMode = 'simple' | 'advanced'

/**
 * Session windows are always the full shell.
 *
 * `openSessionWindow` pops one conversation into its own OS window, at the
 * route `#/<sessionId>`. Simple mode renders NotesShell there — a notes
 * surface that ignores the session route entirely — so a popped-out chat came
 * up showing the notebook and no chat at all. The window kind already says
 * what the window is for; it does not need a stored preference to say it
 * again, and it must not be able to contradict it.
 */
function isSessionWindow(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('win') === 'secondary'
  } catch {
    return false
  }
}

const read = (): UiMode =>
  isSessionWindow() || storedString(KEY) === 'advanced' ? 'advanced' : 'simple'

export const $uiMode = atom<UiMode>(typeof window === 'undefined' ? 'simple' : read())

export function isSimpleMode(): boolean {
  return $uiMode.get() === 'simple'
}

/** Persist and hard-reload — registrations and the default tree are boot-time. */
export function setUiMode(mode: UiMode): void {
  if (mode === $uiMode.get()) {
    return
  }

  persistString(KEY, mode)

  // A hard reload drops whatever the editor hasn't written yet.
  void import('@/app/vault/store')
    .then(store => store.flushActiveNote())
    .catch(() => undefined)
    .finally(() => window.location.reload())
}
