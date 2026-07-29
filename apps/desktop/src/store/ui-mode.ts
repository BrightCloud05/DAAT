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

const KEY = 'biseo.desktop.uiMode.v1'

export type UiMode = 'simple' | 'advanced'

const read = (): UiMode => (storedString(KEY) === 'advanced' ? 'advanced' : 'simple')

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
