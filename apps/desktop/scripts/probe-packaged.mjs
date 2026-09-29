#!/usr/bin/env node
/**
 * Check the artifact you are about to hand someone, not the source tree.
 *
 * WHY THIS EXISTS
 *
 * A fix was verified against the dev build, a DMG was built, and the user then
 * tested the app already installed in /Applications — which predated all of it.
 * Everyone concluded the fix did not work. Nothing about "the tests pass" or
 * "the probes pass" catches that, because both run the source tree.
 *
 * Worse, the check that was supposed to catch it did not: the built bundle was
 * grepped for a string that turned out to have existed all along, so an old
 * build and a new one both "contained the fix".
 *
 * So this drives the real .app out of release/ and asks it to demonstrate the
 * behaviour. A build that cannot is one you find out about here rather than on
 * someone else's Mac.
 *
 * Usage: node scripts/probe-packaged.mjs   (needs `npm run dist:mac:dmg` first)
 */

import { _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DESKTOP_ROOT = path.resolve(import.meta.dirname, '..')
const APP = path.join(DESKTOP_ROOT, 'release', 'mac-arm64', 'Daat.app', 'Contents', 'MacOS', 'Daat')

if (!fs.existsSync(APP)) {
  console.error(`No packaged app at ${APP}. Run \`ALLOW_UNSIGNED=1 npm run dist:mac:dmg\` first.`)
  process.exit(1)
}

const built = fs.statSync(APP).mtime.toISOString()
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'daat-packaged-'))
const home = path.join(tmp, 'home')
const vault = path.join(tmp, 'vault')
const userData = path.join(tmp, 'userData')

for (const dir of [home, vault, userData]) {
  fs.mkdirSync(dir, { recursive: true })
}

const NOTE = [
  '---',
  'title: Heavy',
  'product: DAAT',
  'owner: ALLFJ',
  'audience: students',
  'version: 0.1',
  'status: DRAFT',
  'language: ko',
  '---',
  '',
  '# Heavy Header Note',
  '',
  ...Array.from({ length: 120 }, (_, i) => `Paragraph ${i + 1}: body text that has to earn its room.\n`)
].join('\n')

fs.writeFileSync(path.join(vault, 'Heavy.md'), NOTE, 'utf8')
fs.writeFileSync(path.join(userData, 'vault.json'), JSON.stringify({ root: vault }), 'utf8')

console.log(`packaged app built ${built}`)
console.log(`${APP}\n`)

const app = await electron.launch({
  executablePath: APP,
  args: [],
  env: {
    ...process.env,
    HERMES_HOME: home,
    HERMES_DESKTOP_USER_DATA_DIR: userData,
    HERMES_DESKTOP_BOOT_FAKE: '1'
  }
})

const page = await app.firstWindow()
const failures = []
const crashes = []

page.on('pageerror', error => crashes.push(error.message.slice(0, 160)))

const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)

  if (!ok) {
    failures.push(label)
  }
}

await page.waitForTimeout(3000)
await page.evaluate(() => {
  localStorage.setItem('hermes-desktop-onboarded-v1', '1')
  localStorage.setItem('hermes-onboarding-skipped-v1', '1')
  localStorage.setItem('daat.onboarded.v1', '1')
  localStorage.setItem('daat.persona.v1', 'student')
})
await page.reload()
await page.waitForTimeout(10000)
await page.addStyleTag({
  content: '[class*="z-setup"], [class*="z-connecting"] { display: none !important; pointer-events: none !important; }'
})

console.log('--- it opened and it is Daat ---')
check('a window with the app in it', (await page.locator('aside').count()) > 0)

await page.locator('aside button', { hasText: 'Heavy' }).last().click()
await page.waitForTimeout(2500)

const measure = () =>
  page.evaluate(() => {
    const title = [...document.querySelectorAll('main h1')].find(h => h.textContent?.includes('Heavy'))
    const content = document.querySelector('main .cm-content')

    return {
      titleTop: title ? Math.round(title.getBoundingClientRect().top) : null,
      contentTop: content ? Math.round(content.getBoundingClientRect().top) : null
    }
  })

console.log('\n--- the whole page scrolls as one document ---')
const before = await measure()

await page.locator('main').first().hover()
await page.mouse.wheel(0, 900)
await page.waitForTimeout(1200)

const after = await measure()

console.log(`   title ${before.titleTop} → ${after.titleTop}, body ${before.contentTop} → ${after.contentTop}`)

check(
  'the title scrolls away with the content',
  before.titleTop !== null && after.titleTop !== null && after.titleTop < before.titleTop - 200,
  `moved ${before.titleTop === null || after.titleTop === null ? '?' : before.titleTop - after.titleTop}px`
)

console.log('\n--- setup asks one question, not two ---')
// The removed question is a string the old builds carry and this one must not.
const carriesRemovedQuestion = await page.evaluate(() =>
  document.body.innerHTML.includes("Tell me what you're studying")
)

check('the removed onboarding question is gone', !carriesRemovedQuestion)

console.log('\n--- the inline assistant is wired up ---')
const editor = page.locator('.cm-content').first()

await editor.click()
await page.keyboard.press('ControlOrMeta+a')
await page.waitForTimeout(300)
await page.keyboard.press('ControlOrMeta+i')
await page.waitForTimeout(800)

const overlay = await page
  .locator('[data-inline-ai]')
  .first()
  .innerText()
  .catch(() => '')

check('⌘I opens the assistant with edit actions', /make shorter/i.test(overlay), overlay.slice(0, 60).replace(/\n+/g, ' '))

console.log('\n--- nothing crashed ---')
check('no uncaught exceptions', crashes.length === 0, crashes.slice(0, 3).join(' | '))

await app.close()
fs.rmSync(tmp, { recursive: true, force: true })

console.log(failures.length ? `\nRESULT: ${failures.length} FAILED` : '\nRESULT: the packaged app has the changes')
process.exit(failures.length ? 1 : 0)
