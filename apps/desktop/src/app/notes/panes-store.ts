/**
 * Which of Daat's two panes are showing.
 *
 * These live in a store rather than in NotesShell's local state because the
 * window titlebar has to drive them. Before this, the titlebar's sidebar
 * buttons were wired to the upstream chat shell's panes — surfaces that do not
 * exist on the Notes screen — so every one of them was a no-op. Pressing them
 * did nothing at all, which is worse than not having them.
 */

import { atom } from 'nanostores'

const SIDEBAR_KEY = 'daat.notes.sidebarOpen.v1'
const AGENT_KEY = 'daat.notes.agentOpen.v1'

function remembered(key: string, fallback: boolean): boolean {
  try {
    const stored = window.localStorage.getItem(key)

    return stored === null ? fallback : stored === '1'
  } catch {
    return fallback
  }
}

function remember(key: string, open: boolean): void {
  try {
    window.localStorage.setItem(key, open ? '1' : '0')
  } catch {
    // Private mode or a locked-down profile. The pane still works this session.
  }
}

/** The notes list on the left. Open by default — it is how you navigate. */
export const $notesSidebarOpen = atom(remembered(SIDEBAR_KEY, true))

/** The agent slide-over on the right. Summoned, so closed by default. */
export const $agentPanelOpen = atom(remembered(AGENT_KEY, false))

export function toggleNotesSidebar(): void {
  const next = !$notesSidebarOpen.get()

  $notesSidebarOpen.set(next)
  remember(SIDEBAR_KEY, next)
}

export function setAgentPanelOpen(open: boolean): void {
  if ($agentPanelOpen.get() === open) {
    return
  }

  $agentPanelOpen.set(open)
  remember(AGENT_KEY, open)
}

export function toggleAgentPanel(): void {
  setAgentPanelOpen(!$agentPanelOpen.get())
}
