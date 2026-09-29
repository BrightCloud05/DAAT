import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { unzipSync } from 'fflate'
import yaml from 'js-yaml'

import { BUNDLE_ID_NAME, computeBundleId, readStamp, type RefreshOutcome } from './agent-source'

const REPO = 'BrightCloud05/DAAT'
const RELEASES = `https://api.github.com/repos/${REPO}/releases?per_page=30`
const RECORD = '.daat-runtime-release.json'
const INTERVAL = 6 * 60 * 60_000
const MAX_ARCHIVE = 128 * 1024 * 1024
const MAX_EXPANDED = 512 * 1024 * 1024

interface RuntimeManifest {
  format: 1
  upstream: string
  revision: string
  minimumDesktopVersion: string
  sha256: string
  bytes: number
  executables: string[]
}

interface AppliedRelease {
  id: number
  tag: string
  desktopVersion: string
  upstream: string
}

export interface ReleaseUpdateOptions {
  installed: string
  bundle: string
  hermesHome: string
  desktopVersion: string
  log: (line: string) => void
  refresh: (installed: string, bundle: string) => Promise<RefreshOutcome>
  fetch?: typeof fetch
  now?: number
}

function version(value: string): number[] {
  if (!/^\d+\.\d+\.\d+$/.test(value)) {throw new Error('Unsupported desktop version')}
  return value.split('.').map(Number)
}

function atLeast(current: string, minimum: string): boolean {
  const left = version(current), right = version(minimum)
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) {return left[i] > right[i]}
  }
  return true
}

function relativeFile(name: string): boolean {
  return !!name && !name.includes('\\') && !name.includes('\0') &&
    !name.includes(':') && !name.startsWith('/') &&
    name.split('/').every(part => !!part && part !== '.' && part !== '..')
}

function readApplied(installed: string): AppliedRelease | null {
  const file = path.join(installed, RECORD)
  if (!fs.existsSync(file)) {return null}
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!Number.isSafeInteger(raw.id) || raw.id <= 0 || typeof raw.upstream !== 'string') {
    throw new Error('Invalid installed runtime release record')
  }
  version(raw.desktopVersion)
  return raw
}

function enabled(home: string): boolean {
  const file = path.join(home, 'config.yaml')
  if (!fs.existsSync(file)) {return true}
  const config = yaml.load(fs.readFileSync(file, 'utf8')) as { updates?: { runtime_auto_update?: boolean } } | null
  return config?.updates?.runtime_auto_update !== false
}

async function bytes(url: string, limit: number, fetcher: typeof fetch): Promise<Buffer> {
  const response = await fetcher(url, { signal: AbortSignal.timeout(20_000), headers: { Accept: 'application/vnd.github+json' } })
  if (!response.ok || !response.body) {throw new Error(`Runtime download failed (${response.status})`)}
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {break}
      size += value.byteLength
      if (size > limit) {throw new Error('Runtime download exceeds size limit')}
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
  }
  return Buffer.concat(chunks)
}

function assetUrl(release: any, name: string): string {
  const asset = release.assets?.find((item: any) => item.name === name)
  const prefix = `https://github.com/${REPO}/releases/download/${release.tag_name}/`
  if (asset?.browser_download_url !== prefix + name) {throw new Error(`Missing trusted runtime asset: ${name}`)}
  return asset.browser_download_url
}

function manifestOf(raw: any): RuntimeManifest {
  if (raw?.format !== 1 || !/^v[\w.-]+$/.test(raw.upstream) || !/^[a-f0-9]{40}$/.test(raw.revision) ||
      !/^[a-f0-9]{64}$/.test(raw.sha256) || !Number.isSafeInteger(raw.bytes) || raw.bytes <= 0 || raw.bytes > MAX_ARCHIVE ||
      !Array.isArray(raw.executables) || raw.executables.length > 10_000 || !raw.executables.every(relativeFile)) {
    throw new Error('Invalid DAAT runtime manifest')
  }
  version(raw.minimumDesktopVersion)
  return raw
}

function extract(archive: Buffer, destination: string, manifest: RuntimeManifest): void {
  if (archive.length !== manifest.bytes || crypto.createHash('sha256').update(archive).digest('hex') !== manifest.sha256) {
    throw new Error('DAAT runtime checksum mismatch')
  }
  let expanded = 0, entries = 0
  const files = unzipSync(archive, { filter: entry => {
    const directory = entry.name.endsWith('/')
    if (!relativeFile(directory ? entry.name.slice(0, -1) : entry.name)) {throw new Error('Unsafe runtime archive path')}
    expanded += entry.originalSize
    if (++entries > 50_000 || expanded > MAX_EXPANDED) {throw new Error('Runtime archive exceeds extraction limit')}
    return !directory
  } })
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(destination, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content, { flag: 'wx', mode: manifest.executables.includes(name) ? 0o755 : 0o644 })
  }
  for (const required of ['pyproject.toml', 'uv.lock', 'plugins/vault/__init__.py', 'plugins/memory/vault/__init__.py', 'scripts/verify_daat_runtime.py']) {
    if (!fs.existsSync(path.join(destination, required))) {throw new Error(`Runtime is missing DAAT capability: ${required}`)}
  }
}

/** Called only before a managed backend starts; never restarts an active conversation. */
export async function refreshReleasedRuntime(options: ReleaseUpdateOptions): Promise<RefreshOutcome> {
  const { installed, bundle, hermesHome, desktopVersion, log, refresh } = options
  // Unknown ownership and user checkouts remain governed by the existing installer.
  if (!readStamp(installed) || fs.existsSync(path.join(installed, '.git'))) {return refresh(installed, bundle)}
  let applied: AppliedRelease | null
  try { applied = readApplied(installed) } catch (error) {
    log(`[runtime-update] ${String(error)}; keeping the installed runtime`)
    return refresh(installed, installed)
  }
  // A desktop upgrade may bring a newer contract. First use that desktop's bundled runtime.
  const keepInstalled = applied && atLeast(applied.desktopVersion, desktopVersion)
  // Even when retaining a release, acquire the installer lock and recover any
  // interrupted transaction before declaring the installed tree usable.
  const baseline = await refresh(installed, keepInstalled ? installed : bundle)
  if (['declined', 'failed', 'unavailable'].includes(baseline.action)) {return baseline}
  let stage: string | undefined
  let applying = false
  try {
    applied = readApplied(installed)
    if (!enabled(hermesHome)) {return baseline}
    const cache = path.join(hermesHome, 'runtime-updates')
    fs.mkdirSync(cache, { recursive: true })
    const checked = path.join(cache, 'last-check')
    const now = options.now ?? Date.now()
    const last = fs.existsSync(checked) ? Number(fs.readFileSync(checked, 'utf8')) : 0
    if (last > 0 && last <= now && now - last < INTERVAL) {return baseline}
    const fetcher = options.fetch ?? fetch
    const releases = JSON.parse((await bytes(RELEASES, 2 * 1024 * 1024, fetcher)).toString('utf8'))
    if (!Array.isArray(releases)) {throw new Error('Invalid release listing')}
    const candidates = releases.filter(item => !item.draft && !item.prerelease &&
      /^daat-runtime-[a-f0-9]{40}$/.test(item.tag_name) && Number.isSafeInteger(item.id) && item.id > (applied?.id ?? 0))
      .sort((a, b) => b.id - a.id)
    const release = candidates[0]
    if (!release) {fs.writeFileSync(checked, String(now)); return baseline}
    const manifest = manifestOf(JSON.parse((await bytes(assetUrl(release, 'daat-runtime.json'), 512 * 1024, fetcher)).toString('utf8')))
    if (release.tag_name !== `daat-runtime-${manifest.revision}`) {throw new Error('Release revision mismatch')}
    if (!atLeast(desktopVersion, manifest.minimumDesktopVersion)) {
      log(`[runtime-update] Hermes ${manifest.upstream} requires DAAT ${manifest.minimumDesktopVersion}; keeping current runtime`)
      fs.writeFileSync(checked, String(now))
      return baseline
    }
    const archive = await bytes(assetUrl(release, 'daat-runtime.zip'), MAX_ARCHIVE, fetcher)
    stage = fs.mkdtempSync(path.join(cache, 'candidate-'))
    extract(archive, stage, manifest)
    const record: AppliedRelease = { id: release.id, tag: release.tag_name, desktopVersion, upstream: manifest.upstream }
    fs.writeFileSync(path.join(stage, RECORD), JSON.stringify(record))
    fs.writeFileSync(path.join(stage, BUNDLE_ID_NAME), computeBundleId(stage))
    applying = true
    const result = await refresh(installed, stage)
    log(`[runtime-update] Hermes ${manifest.upstream}: ${result.action}`)
    if (result.action === 'updated' || result.action === 'current') {fs.writeFileSync(checked, String(now))}
    return result
  } catch (error) {
    // The transaction reports ordinary rollback as a result; a thrown error means
    // recovery itself failed and the backend must not start.
    if (applying) {throw error}
    log(`[runtime-update] Check/apply deferred: ${String(error)}; keeping the usable runtime`)
    return baseline
  } finally {
    if (stage) {fs.rmSync(stage, { recursive: true, force: true })}
  }
}
