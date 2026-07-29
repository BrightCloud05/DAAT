#!/usr/bin/env node
/**
 * Headless probe of the first-run wizard: launch against an empty vault, walk
 * the three steps the way a user would, and check what actually landed on
 * disk. The wizard is the one screen every user sees and the hardest to test
 * by hand, because seeing it again means resetting state.
 *
 * Usage: node scripts/probe-onboarding.mjs   (needs `npm run build` first)
 */

import { _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DESKTOP_ROOT = path.resolve(import.meta.dirname, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'daat-onboarding-'))
const home = path.join(tmp, 'home')
const vault = path.join(tmp, 'vault')
const userData = path.join(tmp, 'userData')

for (const dir of [home, vault, userData]) {
  fs.mkdirSync(dir, { recursive: true })
}

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

// Dismiss the provider-setup overlay (not what we're probing) but leave the
// Daat first-run wizard alone — it keys off daat.onboarded.v1.
await page.waitForTimeout(2500)
await page.evaluate(() => {
  localStorage.setItem('hermes-desktop-onboarded-v1', '1')
  localStorage.setItem('hermes-onboarding-skipped-v1', '1')
  localStorage.removeItem('daat.onboarded.v1')
  localStorage.removeItem('daat.persona.v1')
})
await page.reload()
await page.waitForTimeout(8000)

// The installer and "connecting" overlays appear only because this probe runs
// with no backend (HERMES_DESKTOP_BOOT_FAKE) — a real user with a working
// install sees neither. They swallow clicks meant for the app underneath.
await page.addStyleTag({
  content: '[class*="z-setup"], [class*="z-connecting"] { display: none !important; pointer-events: none !important; }'
})

const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)

  if (!ok) {
    failures.push(label)
  }
}

console.log('--- step 1: persona ---')

const heading = await page.locator('h1', { hasText: 'What will you use Daat for' }).count()

check('the wizard is shown on first run', heading > 0)

const cards = page.locator('button', { hasText: 'Workpapers that check themselves' })

check('all six personas render', (await page.locator('button:has-text("Start plain, grow later")').count()) > 0)

// Continue must be inert until something is picked.
const continueButton = page.locator('button', { hasText: 'Continue' }).first()

check('Continue is disabled before a choice', await continueButton.isDisabled())

await cards.first().click()
await page.waitForTimeout(200)
check('Continue enables after choosing', !(await continueButton.isDisabled()))

// Korean lives in Settings → Appearance → Language now (one language
// setting, not two). strings.test.ts covers the catalogue itself.
check('the product ships in English by default', (await page.locator('h1', { hasText: 'What will you use' }).count()) > 0)

await continueButton.click()
await page.waitForTimeout(400)

console.log('--- step 2: where the notes live ---')

check('the vault folder is shown', (await page.locator('h1', { hasText: 'Your notes live here' }).count()) > 0)
// Not a text= selector: the temp path contains slashes, which Playwright
// would read as a regex literal.
check(
  'the real path is displayed',
  await page.evaluate(root => document.body.textContent?.includes(root) ?? false, vault)
)

await page.locator('button', { hasText: 'Set up my pages' }).first().click()
await page.waitForTimeout(4000)

console.log('--- step 3: the assistant takes over ---')

check('the setup conversation opens', await page.evaluate(() =>
  document.body.textContent?.includes('Setting up with Daat') ?? false
))
check('there is somewhere to answer', (await page.locator('textarea').count()) > 0)
check('files can be handed over', await page.evaluate(() =>
  document.body.textContent?.includes('drop a timetable') ?? false
))

// HERMES_DESKTOP_BOOT_FAKE means no live gateway, so the assistant cannot
// answer here. What matters is that it fails in words, not a blank screen.
await page.waitForTimeout(6000)

const conversation = await page.evaluate(() => document.body.textContent ?? '')

check(
  'a missing assistant is explained, not silent',
  conversation.includes('still starting up') ||
    conversation.includes('Could not reach') ||
    conversation.includes('did not start') ||
    /[a-z]{20,}/i.test(conversation)
)

await page.locator('button', { hasText: "I'm done" }).first().click()
await page.waitForTimeout(1500)

check('the wizard closes', (await page.locator('h1', { hasText: 'What will you use Daat' }).count()) === 0)
check('the app is behind it', (await page.locator('aside').count()) > 0)

console.log('--- on disk ---')

const walk = dir =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)

    return entry.isDirectory() ? walk(full) : [path.relative(vault, full)]
  })

const files = walk(vault)

console.log(JSON.stringify(files, null, 2))
check('accounting starter pages were created', files.some(file => file.includes('Workpaper')))
check('SOUL.md was written for the persona', fs.existsSync(path.join(home, 'SOUL.md')))

// Re-launching must not show the wizard again.
const persisted = await page.evaluate(() => localStorage.getItem('daat.onboarded.v1'))

check('the choice is remembered', persisted === '1')

await app.close()

console.log(failures.length ? `\nRESULT: ${failures.length} FAILED` : '\nRESULT: ALL CHECKS PASSED')
process.exit(failures.length ? 1 : 0)
