#!/usr/bin/env node
/**
 * What the app does on a machine that has none of its optional dependencies.
 *
 * Every screen here leans on something the user's Mac may simply not have:
 * Mail needs the `himalaya` CLI, Meetings needs a microphone and a Whisper
 * model, the agent needs a configured provider. On the developer's machine all
 * of that is present, so these paths are the least-exercised code in the app
 * and the FIRST thing a new user meets.
 *
 * The bar is not "it works" — it cannot. The bar is that each screen says what
 * is missing and what to do about it, in the user's language, without a dead
 * end and without leaking an exception. A screen that silently shows nothing
 * reads as a broken app; a screen that says "Mail needs Himalaya, here is the
 * one command" reads as an app that is honest with you.
 *
 * Simulates the bare machine by removing every user-installed bin directory
 * from PATH, so `himalaya`, `rg`, `uv` and friends genuinely cannot be found.
 *
 * Usage: node scripts/probe-bare.mjs   (needs `npm run build` first)
 */

import { _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DESKTOP_ROOT = path.resolve(import.meta.dirname, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'daat-bare-'))
const home = path.join(tmp, 'home')
const vault = path.join(tmp, 'vault')
const userData = path.join(tmp, 'userData')

for (const dir of [home, vault, userData]) {
  fs.mkdirSync(dir, { recursive: true })
}

fs.writeFileSync(path.join(vault, 'A note.md'), '# A note\n\n- [ ] something\n', 'utf8')
fs.writeFileSync(path.join(userData, 'vault.json'), JSON.stringify({ root: vault }), 'utf8')

// A PATH with only the system directories — no homebrew, no ~/.local/bin, no
// cargo, no nvm. This is what a Mac out of the box looks like.
const BARE_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'

const stillThere = ['himalaya', 'rg', 'uv', 'node'].filter(bin =>
  BARE_PATH.split(':').some(dir => fs.existsSync(path.join(dir, bin)))
)

console.log(`bare PATH: ${BARE_PATH}`)
console.log(`unexpectedly present: ${stillThere.length ? stillThere.join(', ') : 'none'}\n`)

const app = await electron.launch({
  args: [DESKTOP_ROOT],
  env: {
    ...process.env,
    PATH: BARE_PATH,
    // himalayaBinary() falls back to well-known install directories when PATH
    // has nothing, precisely so a Finder-launched app still finds a Homebrew
    // install. Pointing it at a path that does not exist is how you say "this
    // machine genuinely does not have it".
    HIMALAYA_BIN: path.join(tmp, 'no-himalaya-here'),
    HERMES_HOME: home,
    HERMES_DESKTOP_USER_DATA_DIR: userData,
    HERMES_DESKTOP_BOOT_FAKE: '1'
  }
})

const page = await app.firstWindow()
const failures = []
const crashes = []

page.on('pageerror', error => crashes.push(error.message.slice(0, 160)))

await page.waitForTimeout(2500)
await page.evaluate(() => {
  localStorage.setItem('hermes-desktop-onboarded-v1', '1')
  localStorage.setItem('hermes-onboarding-skipped-v1', '1')
  localStorage.setItem('daat.onboarded.v1', '1')
  localStorage.setItem('daat.persona.v1', 'student')
})
await page.reload()
await page.waitForTimeout(9000)
await page.addStyleTag({
  content: '[class*="z-setup"], [class*="z-connecting"] { display: none !important; pointer-events: none !important; }'
})

const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)

  if (!ok) {
    failures.push(label)
  }
}

const canvas = () => page.evaluate(() => document.querySelector('main')?.innerText ?? '')

const open = async name => {
  await page.locator('aside button', { hasText: name }).last().click()
  await page.waitForTimeout(1800)
}

/**
 * A screen with a missing dependency must still say something actionable.
 * "Actionable" means: names what is missing, or tells the user what to do.
 */
async function explains(screen, expectations) {
  const text = await canvas()

  check(`${screen}: is not blank`, text.trim().length > 30, `${text.trim().length} chars`)
  check(
    `${screen}: no raw error leaks to the user`,
    !/\b(ENOENT|EACCES|undefined|null|NaN|\[object|Traceback|spawn \w+ ENOENT)\b/.test(text),
    text.slice(0, 90).replace(/\n+/g, ' ')
  )

  for (const [what, pattern] of expectations) {
    check(`${screen}: ${what}`, pattern.test(text), text.slice(0, 110).replace(/\n+/g, ' '))
  }
}

console.log('--- Mail, on a Mac with no himalaya ---')
await open('Mail')
await explains('Mail', [
  ['says what is missing', /himalaya/i],
  ['tells the user how to fix it', /install|brew|connect/i]
])

console.log('\n--- Meetings, with no microphone and no model ---')
await open('Meetings')
await explains('Meetings', [['offers the action anyway', /record/i]])

console.log('\n--- the screens that need nothing external ---')
for (const screen of ['Home', 'Notes', 'Todo', 'Calendar', 'Money', 'Graph']) {
  await open(screen)
  await explains(screen, [])
}

console.log('\n--- the editor still works with no tooling at all ---')
await page.locator('aside button', { hasText: 'A note' }).last().click()
await page.waitForTimeout(1500)
check('a note opens', (await canvas()).includes('A note'))

console.log('\n--- nothing crashed ---')
check('no uncaught exceptions', crashes.length === 0, crashes.slice(0, 3).join(' | '))

await app.close()

console.log(failures.length ? `\nRESULT: ${failures.length} FAILED` : '\nRESULT: ALL CHECKS PASSED')
process.exit(failures.length ? 1 : 0)
