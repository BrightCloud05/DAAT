#!/usr/bin/env node
// Runs only on an ephemeral Windows Actions runner, against the installed EXE.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from '@playwright/test'

assert.equal(process.platform, 'win32', 'This acceptance probe requires native Windows')
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Use an isolated Actions runner')
const executablePath = process.argv[2]
assert.ok(executablePath && fs.existsSync(executablePath), 'Installed executable is required')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daat-acceptance-'))
const home = path.join(root, 'runtime')
const userData = path.join(root, 'user-data')
const vault = path.join(root, 'Test vault 한글')
const output = path.resolve('release/acceptance')
for (const dir of [home, userData, vault, output]) fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(path.join(userData, 'vault.json'), JSON.stringify({ root: vault }))
fs.writeFileSync(path.join(vault, 'Trial.md'), '# Windows trial\n\nDisposable note.\n')
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)/i.test(key) &&
  !/^(HERMES|ELECTRON|PYTHON|VIRTUAL_ENV|CONDA|NODE_OPTIONS)/.test(key)))
Object.assign(env, {
  HERMES_HOME: home,
  HERMES_DESKTOP_USER_DATA_DIR: userData,
  HERMES_DESKTOP_IGNORE_EXISTING: '1',
  HERMES_DESKTOP_SKIP_QUIT_CONFIRM: '1',
})
const report = { platform: process.platform, arch: process.arch, checks: [], status: 'running' }
let app
let page
const errors = []
async function launch(fresh = false) {
  app = await electron.launch({ executablePath, args: [], cwd: root, env, timeout: 90_000 })
  page = await app.firstWindow({ timeout: 90_000 })
  page.on('pageerror', error => errors.push(error.message))
  // First boot must use the actual bundled installer and real Python backend.
  // No BOOT_FAKE, source-root override, preinstalled venv or hidden overlay.
  await page.waitForFunction(() => Boolean(window.hermesDesktop), null, { timeout: 60_000 })
  if (fresh) {
    await page.getByRole('button', { name: 'Set up Daat on this computer', exact: true }).click({ timeout: 90_000 })
    report.checks.push('First-run local setup button started installation')
  }
  const connection = await Promise.race([
    page.evaluate(() => window.hermesDesktop.getConnection()),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Fresh bootstrap exceeded 20 minutes')), 20 * 60_000).unref()),
  ])
  assert.equal(connection.mode, 'local')
  const url = new URL(connection.baseUrl)
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname))
  const health = await fetch(new URL('/api/health', url), {
    headers: { Authorization: `Bearer ${connection.token}` }, signal: AbortSignal.timeout(30_000),
  })
  assert.equal(health.status, 200, 'Real backend health must succeed')
  assert.equal((await health.json()).ok, true, 'Health response must be the backend JSON')
  report.checks.push('Installed app connected to a healthy local Python backend')
  return page
}
try {
  await launch(true)
  await page.screenshot({ path: path.join(output, 'first-launch.png') })
  // Provider setup is deliberately not exercised without a user account.
  // Record the onboarding screen, then select the existing offline notes path.
  await page.evaluate(() => {
    localStorage.setItem('hermes-desktop-onboarded-v1', '1')
    localStorage.setItem('hermes-onboarding-skipped-v1', '1')
    localStorage.setItem('daat.onboarded.v1', '1')
  })
  await page.reload()
  await page.locator('aside button', { hasText: 'Trial' }).first().click({ timeout: 90_000 })
  await page.locator('.cm-content').first().click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('\nSaved on Windows: 한글 persistence.\n')
  const file = path.join(vault, 'Trial.md')
  const deadline = Date.now() + 30_000
  while (!fs.readFileSync(file, 'utf8').includes('한글 persistence.')) {
    assert.ok(Date.now() < deadline, 'Editor content must reach the real Markdown file')
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  const saved = fs.readFileSync(file, 'utf8')
  report.checks.push('UI saved Unicode text in a vault with spaces and Korean characters')
  await app.close(); app = null
  await launch()
  await page.locator('aside button', { hasText: 'Trial' }).first().click({ timeout: 90_000 })
  await page.locator('.cm-content').first().getByText('한글 persistence.', { exact: false }).waitFor({ timeout: 30_000 })
  assert.equal(fs.readFileSync(file, 'utf8'), saved)
  report.checks.push('Saved bytes and editor contents survived app restart')
  await page.screenshot({ path: path.join(output, 'restarted.png') })
  assert.deepEqual(errors, [], 'No uncaught renderer exceptions')
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'
  report.error = String(error)
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
    const bootstrap = await page.evaluate(() => window.hermesDesktop.getBootstrapState()).catch(() => null)
    if (bootstrap) report.bootstrap = { active: bootstrap.active, error: bootstrap.error, stages: bootstrap.stages, log: bootstrap.log?.slice(-80) }
    report.screen = (await page.locator('body').innerText().catch(() => '')).slice(0, 12000)
  }
  process.exitCode = 1
} finally {
  if (app) await app.close().catch(() => {})
  report.limitations = ['Windows Server runner; Windows 10/11 not tested', 'Provider sign-in and AI calls not tested', 'Onboarding completion bypassed for offline note test', 'Unsigned executable']
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
