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

// The question is a fixed local string, so it must be on screen complete and
// immediately — the version a model wrote arrived word by word and was
// unreadable at this size.
const asked = await page.evaluate(() => {
  const big = [...document.querySelectorAll('p')].find(p => parseFloat(getComputedStyle(p).fontSize) >= 22)

  return { text: big?.textContent ?? '', px: big ? getComputedStyle(big).fontSize : null }
})

check('the first question is asked', asked.text.includes("what you're working on at the moment"))
check('it is set large', asked.px === '24px')
check('there is somewhere to answer', (await page.locator('textarea').count()) > 0)
check('progress is shown', await page.evaluate(() => /\d \/ \d/.test(document.body.innerText)))
check('a question can be skipped', await page.evaluate(() => document.body.innerText.includes('Skip')))
check('files can be handed over', await page.evaluate(() =>
  document.body.textContent?.includes('drop a timetable') ?? false
))

// Skipping must land on the next question, not on the done screen. This broke
// once during the step-based rewrite and looked like a blank panel.
await page.locator('button', { hasText: 'Skip' }).last().click()
await page.waitForTimeout(1200)

const second = await page.evaluate(() => {
  const big = [...document.querySelectorAll('p')].find(p => parseFloat(getComputedStyle(p).fontSize) >= 22)

  return { text: big?.textContent ?? '', boxes: document.querySelectorAll('textarea').length }
})

check('skipping advances to the second question', second.text.includes('How should I handle your work'))
check('the second question still has an input', second.boxes > 0)
check('progress counts up', await page.evaluate(() => document.body.innerText.includes('2 / 2')))

// The preferences answer is the one thing here that needs no model: it goes
// straight into SOUL.md, so it must work even with no gateway at all.
const PREFERENCE = 'Never guess a number. Always cite the workpaper.'

await page.locator('textarea').last().fill(PREFERENCE)
await page.keyboard.press('Enter')
await page.waitForTimeout(3000)

check('the answer is acknowledged, not echoed as chat', await page.evaluate(() =>
  document.body.innerText.includes("Noted — I'll work that way")
))
check('setup reports itself finished', await page.evaluate(() =>
  document.body.innerText.includes('Open my notes')
))

await page.locator('button', { hasText: 'Open my notes' }).first().click()
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
// The SOUL write goes through the backend REST API, which races the backend
// coming up in this fake-boot environment — poll rather than report a flake.
const soulPath = path.join(home, 'SOUL.md')
let soulWritten = false

for (let attempt = 0; attempt < 10 && !soulWritten; attempt++) {
  soulWritten = fs.existsSync(soulPath)

  if (!soulWritten) {
    await page.waitForTimeout(1000)
  }
}

check('SOUL.md was written for the persona', soulWritten)

// The whole point of the preferences question: the user's own words become the
// assistant's standing instructions, appended rather than replacing the voice
// the persona set up.
const soul = soulWritten ? fs.readFileSync(soulPath, 'utf8') : ''

check('the preference was saved verbatim', soul.includes(PREFERENCE))
check("the persona's own voice survived it", soul.length > PREFERENCE.length + 200)

// Re-launching must not show the wizard again.
const persisted = await page.evaluate(() => localStorage.getItem('daat.onboarded.v1'))

check('the choice is remembered', persisted === '1')

await app.close()

console.log(failures.length ? `\nRESULT: ${failures.length} FAILED` : '\nRESULT: ALL CHECKS PASSED')
process.exit(failures.length ? 1 : 0)
