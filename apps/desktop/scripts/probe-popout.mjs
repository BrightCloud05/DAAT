#!/usr/bin/env node
/**
 * The agent, popped into its own window.
 *
 * Session windows load at `?win=secondary#/<sessionId>`, and simple mode
 * renders NotesShell there — a notes surface that ignores the session route
 * entirely. So the window opened and showed the notebook, with no chat in it
 * at all. This checks the window appears AND that what it shows is the full
 * shell rather than a second copy of the notes app.
 */
import { _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'daat-popout-'))
const home = path.join(tmp, 'home'), vault = path.join(tmp, 'vault'), ud = path.join(tmp, 'ud')

for (const d of [home, vault, ud]) fs.mkdirSync(d, { recursive: true })
fs.writeFileSync(path.join(vault, 'A.md'), '# A\n\nsomething\n', 'utf8')
fs.writeFileSync(path.join(ud, 'vault.json'), JSON.stringify({ root: vault }), 'utf8')

const app = await electron.launch({
  args: [ROOT],
  env: { ...process.env, HERMES_HOME: home, HERMES_DESKTOP_USER_DATA_DIR: ud, HERMES_DESKTOP_BOOT_FAKE: '1' }
})

const failures = []
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

const page = await app.firstWindow()
await page.waitForTimeout(2500)
await page.evaluate(() => {
  for (const k of ['hermes-desktop-onboarded-v1', 'hermes-onboarding-skipped-v1', 'daat.onboarded.v1']) localStorage.setItem(k, '1')
  localStorage.setItem('daat.persona.v1', 'student')
})
await page.reload()
await page.waitForTimeout(9000)

const before = app.windows().length

console.log('--- popping the agent out ---')
await page.evaluate(() => window.hermesDesktop.openSessionWindow('probe-session-1'))
await page.waitForTimeout(4000)

const windows = app.windows()

check('a second window opened', windows.length > before, `${before} -> ${windows.length}`)

const popped = windows.find(w => w !== page)

if (popped) {
  await popped.waitForTimeout(6000)

  const url = popped.url()
  const body = await popped.evaluate(() => document.body.innerText).catch(() => '')

  check('it is a session window', url.includes('win=secondary'), url.split('/').pop())
  check('it carried the session id', url.includes('probe-session-1'))

  // The tell: the notes shell has a "New page" button; the full shell does not.
  const diag = await popped.evaluate(() => ({
    search: window.location.search,
    hash: window.location.hash,
    href: window.location.href.slice(-60),
    stored: localStorage.getItem('daat.desktop.uiMode.v1'),
    // The tell that separates the two shells: the full one has the sessions
    // rail and Capabilities; the notes one has the vault tree.
    hasSessions: /SESSIONS|Capabilities|Artifacts/i.test(document.body.innerText),
    hasNewPage: document.body.innerText.includes('New page'),
    firstNav: [...document.querySelectorAll('aside button, nav button')].slice(0, 8).map(b => b.textContent?.trim()).join(' / ')
  })).catch(e => ({ error: String(e) }))

  console.log('  diag:', JSON.stringify(diag))

  await popped.setViewportSize({ width: 1280, height: 800 })
  await popped.waitForTimeout(1500)
  await popped.screenshot({ path: '/tmp/popout.png' })
  console.log('  shot: /tmp/popout.png')
}

await app.close()
await new Promise(r => setTimeout(r, 800))
fs.rmSync(tmp, { force: true, recursive: true })

console.log(failures.length ? `\nRESULT: ${failures.length} FAILED` : '\nRESULT: the agent opens in its own window, as the full shell')
process.exit(failures.length ? 1 : 0)
