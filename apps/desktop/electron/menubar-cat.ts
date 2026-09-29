/** Electron owns the helper's settings, process and active runtime context. */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { app } from 'electron'

import { type CatContext, type CatSettings, sanitizeCatSettings } from './menubar-cat-settings'

let context: CatContext | undefined
let lastError: string | null = null
let startupTimer: ReturnType<typeof setTimeout> | undefined
let launchPending: Promise<void> | undefined
const settingsFile = () => path.join(app.getPath('userData'), 'menubar-cat.json')
const processFile = () => `${settingsFile()}.process`

export function readMenubarCatSettings(): CatSettings {
  try { return sanitizeCatSettings(JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))) }
  catch { return sanitizeCatSettings(null) }
}

function persist(settings: CatSettings, runRequested?: boolean): void {
  const file = settingsFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  let previousRun = true

  try { previousRun = JSON.parse(fs.readFileSync(file, 'utf8')).runRequested !== false } catch { /* new settings */ }
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({ ...settings, ...context, runRequested: runRequested ?? previousRun }), { mode: 0o600 })
  fs.renameSync(`${file}.tmp`, file)
}

export function updateMenubarCatContext(next: CatContext): void {
  context = next
  persist(readMenubarCatSettings())
}

function helperPath(): string | null {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'DAAT Cat.app') : '',
    path.resolve(app.getAppPath(), '..', 'daatcat', 'dist', 'DAAT Cat.app'),
    path.join(app.getPath('home'), 'Applications', 'DAAT Cat.app')
  ]

  return candidates.find(candidate => fs.existsSync(path.join(candidate, 'Contents', 'MacOS', 'DaatCat'))) || null
}

/** The helper owns its heartbeat; no process search or argv guessing. */
function isRunning(): boolean {
  try {
    const saved = JSON.parse(fs.readFileSync(processFile(), 'utf8'))

    return Number.isFinite(saved.updatedAt) && Date.now() - saved.updatedAt >= 0 && Date.now() - saved.updatedAt < 7000
  } catch { return false }
}

export async function getMenubarCatStatus() {
  return {
    supported: process.platform === 'darwin', available: process.platform === 'darwin' && Boolean(helperPath()),
    running: process.platform === 'darwin' && isRunning(), error: lastError,
    runtimeHome: context?.runtimeHome || '', profile: context?.profile || 'default',
    mode: context?.mode || 'local', usageSource: '~/.codex/auth.json'
  }
}

export async function stopMenubarCat(): Promise<void> {
  if (startupTimer) {clearTimeout(startupTimer)}
  startupTimer = undefined

  if (launchPending) {await launchPending.catch(() => undefined)}
  persist(readMenubarCatSettings(), false)

  for (let attempt = 0; attempt < 40 && isRunning(); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 200))
  }

  if (isRunning()) {throw new Error('DAAT Cat has not stopped yet. Try again after it responds.')}
  lastError = null
}

export async function startMenubarCat(): Promise<void> {
  if (launchPending) {return launchPending}
  launchPending = (async () => {
    if (process.platform !== 'darwin') {throw new Error('DAAT Cat is available on macOS.')}

    if (!readMenubarCatSettings().enabled) {throw new Error('Enable DAAT Cat before starting it.')}

    if (isRunning()) {return}
    const helper = helperPath()

    if (!helper) {throw new Error('This build does not include DAAT Cat. Reinstall the complete Daat app.')}
    persist(readMenubarCatSettings(), true)
    const executable = path.join(helper, 'Contents', 'MacOS', 'DaatCat')
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, ['--config', settingsFile()], {
        detached: true, stdio: 'ignore', env: { ...process.env, HERMES_HOME: context?.runtimeHome || path.join(app.getPath('home'), '.daat') }
      })

      child.once('error', reject)
      child.once('exit', code => reject(new Error(`DAAT Cat exited before it was ready (${code ?? 'signal'}).`)))
      child.once('spawn', () => {
        void (async () => {
          for (let attempt = 0; attempt < 50; attempt++) {
            try {
              const saved = JSON.parse(fs.readFileSync(processFile(), 'utf8'))

              if (saved.pid === child.pid && isRunning()) {
                child.unref()
                resolve()

                return
              }
            } catch { /* wait for the helper's first heartbeat */ }

            await new Promise(ready => setTimeout(ready, 100))

            if (child.exitCode !== null || child.signalCode !== null) {return}
          }

          child.kill()
          reject(new Error('DAAT Cat did not become ready. Try starting it again.'))
        })().catch(reject)
      })
    })
    lastError = null
  })().catch(error => { lastError = error.message; throw error }).finally(() => { launchPending = undefined })

  return launchPending
}

export async function setMenubarCatSettings(patch: unknown): Promise<CatSettings> {
  const before = readMenubarCatSettings()
  const settings = sanitizeCatSettings(patch, before)
  persist(settings)

  if (!settings.enabled) {await stopMenubarCat()}
  else if (!before.enabled) {await startMenubarCat()}

  return settings
}

export function ensureMenubarCat(next: CatContext): void {
  updateMenubarCatContext(next)
  const settings = readMenubarCatSettings()

  if (process.platform !== 'darwin' || !settings.enabled || !settings.autoStart) {return}
  startupTimer = setTimeout(() => { void startMenubarCat().catch(error => { lastError = error.message }) }, 4000)
}

export async function quitMenubarCatWithApp(): Promise<void> {
  if (startupTimer) {clearTimeout(startupTimer)}
  startupTimer = undefined

  if (readMenubarCatSettings().quitWithApp) {await stopMenubarCat()}
}
