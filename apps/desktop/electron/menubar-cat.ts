/**
 * menubar-cat.ts — launches the bundled DAAT Cat menu bar helper.
 *
 * DAAT Cat is a native Swift menu bar app (apps/daatcat) shipped inside
 * Daat.app's Resources by scripts/stage-daatcat.mjs: a RunCat-style cat
 * whose pace follows system load, with a panel showing system stats, agent
 * credit usage and DAAT 진행사항. It runs as its own process so it keeps
 * monitoring even when Daat itself is closed — which is also why quitting
 * Daat deliberately leaves the cat alone.
 *
 * Default-on, opted out via userData/menubar-cat.json {"enabled": false}.
 * macOS only: the helper is an NSStatusItem app.
 */

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { app } from 'electron'

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'menubar-cat.json')
}

export function menubarCatEnabled(): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) as { enabled?: boolean }

    return parsed.enabled !== false
  } catch {
    // No settings file yet — the cat is a default feature.
    return true
  }
}

export function setMenubarCatEnabled(enabled: boolean): void {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify({ enabled }, null, 2), 'utf8')
  } catch {
    // Non-fatal: the choice still applies to this session.
  }

  if (enabled) {
    launchHelper()
  } else {
    execFile('pkill', ['-x', 'DaatCat'], () => undefined)
  }
}

/** Bundled helper first, then the dev build, then a manual install. */
function helperPath(): string | null {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'DAAT Cat.app') : null,
    path.resolve(app.getAppPath(), '..', 'daatcat', 'dist', 'DAAT Cat.app'),
    path.join(app.getPath('home'), 'Applications', 'DAAT Cat.app')
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

function launchHelper(): void {
  // pgrep exits non-zero when nothing matches — that is the "not running,
  // go launch it" signal, so one cat never becomes two.
  execFile('pgrep', ['-x', 'DaatCat'], error => {
    if (!error) {
      return
    }

    const target = helperPath()

    if (target) {
      execFile('open', [target], () => undefined)
    }
  })
}

/** Called once from app.whenReady(); quiet no-op off macOS or when opted out. */
export function ensureMenubarCat(): void {
  if (process.platform !== 'darwin' || !menubarCatEnabled()) {
    return
  }

  // A few seconds after boot: the cat is ambience, not the critical path.
  setTimeout(launchHelper, 4000)
}
