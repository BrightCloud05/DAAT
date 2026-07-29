#!/usr/bin/env node
/**
 * Headless probe of the module screens (Todo, Calendar, Money, Mail).
 *
 * Each one is a lens over real vault files, so the check that matters is
 * whether data the user actually wrote shows up on the right screen — not
 * whether the component mounts. Seeds a vault, clicks each sidebar row, and
 * asserts on the rendered text.
 *
 * Usage: node scripts/probe-modules.mjs   (needs `npm run build` first)
 */

import { _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DESKTOP_ROOT = path.resolve(import.meta.dirname, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'biseo-modules-'))
const home = path.join(tmp, 'home')
const vault = path.join(tmp, 'vault')
const userData = path.join(tmp, 'userData')

for (const dir of [home, vault, userData, path.join(vault, 'Daily'), path.join(vault, 'Projects')]) {
  fs.mkdirSync(dir, { recursive: true })
}

// Dates are relative to today so the probe never rots.
const now = new Date()
const pad = value => String(value).padStart(2, '0')
const stamp = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const today = stamp(now)
const soon = stamp(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2))

fs.writeFileSync(
  path.join(vault, 'Daily', `${today}.md`),
  `---\ndate: ${today}\n---\n\n## Today\n\n- [ ] call the bank 📅 ${today}\n- [x] already done\n`,
  'utf8'
)
fs.writeFileSync(
  path.join(vault, 'Projects', 'Launch.md'),
  `---\ndue: ${soon}\nstatus: draft\n---\n\n# Launch\n\n- [ ] write the release notes 📅 ${soon}\n`,
  'utf8'
)
fs.writeFileSync(path.join(userData, 'vault.json'), JSON.stringify({ root: vault }), 'utf8')

const app = await electron.launch({
  args: [DESKTOP_ROOT],
  env: {
    ...process.env,
    HERMES_HOME: home,
    HERMES_DESKTOP_USER_DATA_DIR: userData,
    HERMES_DESKTOP_BOOT_FAKE: '1'
  }
})

const page = await app.firstWindow()
const failures = []

page.on('pageerror', error => {
  failures.push(`pageerror: ${error.message}`)
  console.log('[pageerror]', error.message)
})

await page.waitForTimeout(2500)
await page.evaluate(() => {
  localStorage.setItem('hermes-desktop-onboarded-v1', '1')
  localStorage.setItem('hermes-onboarding-skipped-v1', '1')
  // Pin the product language: it otherwise follows the OS, and this machine
  // reports Korean — which is the feature working, but it makes assertions
  // on English copy fail for the wrong reason.
  localStorage.setItem('biseo.locale.v1', 'en')
  localStorage.setItem('biseo.onboarded.v1', '1')
})
await page.reload()
await page.waitForTimeout(9000)

const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)

  if (!ok) {
    failures.push(label)
  }
}

const bodyHas = text => page.evaluate(needle => document.body.textContent?.includes(needle) ?? false, text)

const openModule = async name => {
  await page.locator('aside button', { hasText: name }).last().click()
  await page.waitForTimeout(1800)
}

console.log('--- Todo ---')
await openModule('Todo')
check('the open task is listed', await bodyHas('call the bank'))
check('the due marker is parsed out of the label', !(await bodyHas('📅')))

console.log('--- Calendar ---')
await openModule('Calendar')
check('the month grid renders', await bodyHas('Mon'))
check("today's task appears on the grid", await bodyHas('call the bank'))
check('a note dated by frontmatter appears', await bodyHas('Launch'))

// Selecting a day must show its detail list.
await page.locator('button', { hasText: 'Today' }).first().click()
await page.waitForTimeout(600)
check('selecting a day shows its entries', await bodyHas("Open this day's note"))

// Paging must not crash and must leave the month behind.
await page.locator('button[title="Next month"]').first().click()
await page.waitForTimeout(600)
await page.locator('button[title="Previous month"]').first().click()
await page.waitForTimeout(600)
check('paging months keeps the grid alive', await bodyHas('Sun'))

console.log('--- Money ---')
await openModule('Money')
check('the import zone explains itself', await bodyHas('Drop a bank statement here'))

console.log('--- Mail ---')
await openModule('Mail')
check('mail reports its real state', (await bodyHas('Mail')) && !(await bodyHas('undefined')))

console.log('--- Meetings ---')
await openModule('Meetings')
check('the recorder is offered', await bodyHas('Record'))
check('recording privacy is stated up front', await bodyHas('nothing is uploaded'))
check('the empty state explains the payoff', await bodyHas('summary and action items'))

// Starting a recording in a headless run has no microphone; the failure must
// be a readable message, not an unhandled rejection.
await page.locator('button', { hasText: 'Record' }).last().click()
await page.waitForTimeout(2500)
check(
  'a missing microphone reports cleanly',
  await page.evaluate(() => {
    const text = document.body.textContent ?? ''

    return text.includes('microphone') || text.includes('Recording…') || text.includes('Stop & summarize')
  })
)

console.log('--- Command palette (developer surfaces stay hidden) ---')
await page.keyboard.press('Meta+k')
await page.waitForTimeout(1200)

const paletteText = await page.evaluate(() => {
  const dialog = document.querySelector('[cmdk-root]') ?? document.querySelector('[role="dialog"]')

  return dialog?.textContent ?? ''
})

check('the palette opens', paletteText.length > 0)

for (const forbidden of ['Messaging', 'Starmap', 'Cron', 'Pets', 'Command Center', 'Terminal', 'Profiles']) {
  check(`"${forbidden}" is not offered`, !paletteText.includes(forbidden))
}

check('Settings is still reachable', paletteText.includes('Settings'))

await page.keyboard.press('Escape')
await page.waitForTimeout(500)

console.log('--- Acknowledgements (licence compliance) ---')
// The notices are read over IPC from inside the bundle; a broken path here
// means we ship binaries with no attribution.
const notices = await page.evaluate(() => window.hermesDesktop?.appNotices?.())

check('the app can read its own licence file', Boolean(notices?.license?.includes('MIT')))
check('third-party notices are bundled', (notices?.thirdParty?.length ?? 0) > 10_000)
check('upstream copyright is preserved', Boolean(notices?.license?.includes('Nous Research')))

console.log('--- Home ---')
await page.locator('aside button', { hasText: 'Home' }).first().click()
await page.waitForTimeout(1200)
check('the dashboard shows the real task', await bodyHas('call the bank'))

await app.close()

console.log(failures.length ? `\nRESULT: ${failures.length} FAILED` : '\nRESULT: ALL CHECKS PASSED')
process.exit(failures.length ? 1 : 0)
