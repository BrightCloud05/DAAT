#!/usr/bin/env node
/**
 * Whole-app audit sweep.
 *
 * Walks every screen a user can reach and looks for the failures that don't
 * throw and don't fail a unit test — the ones you only find by reading the
 * actual pixels:
 *
 *   · raw JS artefacts rendered as copy ("undefined", "NaN", "[object Object]")
 *   · console errors and unhandled rejections on any screen
 *   · icon-only controls with no accessible name
 *   · empty rendered regions where a screen should have content
 *
 * The `[object Object]` check exists because that is literally what shipped in
 * the properties panel: `date: {{date}}` is valid YAML flow-mapping syntax, so
 * opening a template parsed the placeholder into a map whose key was a map.
 * Nothing threw; it just sat there on screen looking like a bug report.
 *
 * Usage: node scripts/probe-audit.mjs   (needs `npm run build` first)
 */

import { _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DESKTOP_ROOT = path.resolve(import.meta.dirname, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'daat-audit-'))
const home = path.join(tmp, 'home')
const vault = path.join(tmp, 'vault')
const userData = path.join(tmp, 'userData')

for (const dir of [home, vault, userData, path.join(vault, 'Daily'), path.join(vault, 'Courses'), path.join(vault, 'Money')]) {
  fs.mkdirSync(dir, { recursive: true })
}

const now = new Date()
const pad = value => String(value).padStart(2, '0')
const stamp = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const today = stamp(now)
const soon = stamp(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3))
const past = stamp(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 4))
const month = today.slice(0, 7)

fs.writeFileSync(
  path.join(vault, 'Daily', `${today}.md`),
  `---\ndate: ${today}\n---\n\n## Today\n\n- [ ] call the bank 📅 ${today}\n- [ ] overdue thing 📅 ${past}\n- [ ] later thing 📅 ${soon}\n`,
  'utf8'
)
fs.writeFileSync(
  path.join(vault, 'Courses', 'Linear Algebra.md'),
  `---\ntype: course\ncode: MATH2001\nroom: Carslaw 350\ndays: [${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][now.getDay()]}]\ntime: "09:00"\ntags: [maths, semester-2]\n---\n\n# Linear Algebra\n`,
  'utf8'
)
fs.writeFileSync(
  path.join(vault, 'Courses', 'Assignment 2.md'),
  `---\ntype: assessment\ncourse: MATH2001\ndue: ${soon}\nweight: 30%\nstatus: not started\n---\n\n# Assignment 2\n`,
  'utf8'
)
// A template whose frontmatter still holds unsubstituted placeholders. This is
// the note that surfaced the `[object Object]` bug.
fs.writeFileSync(
  path.join(vault, 'Courses', 'Lecture Template.md'),
  '---\ntype: lecture\ncourse: \ndate: "{{date}}"\ntopic: \n---\n\n## Key points\n\n- \n',
  'utf8'
)
fs.writeFileSync(
  path.join(vault, 'Money', `${month}.md`),
  `---\ntype: money\n---\n\n| Date | Description | Category | Amount |\n| --- | --- | --- | --- |\n| ${today} | salary | income | 4200.00 |\n| ${today} | groceries | food | -84.20 |\n| ${today} | rent | housing | -1800.00 |\n`,
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
const consoleErrors = []

page.on('pageerror', error => consoleErrors.push(`pageerror: ${error.message}`))
page.on('console', message => {
  if (message.type() !== 'error') {
    return
  }

  const text = message.text()

  // Missing-backend noise is expected under HERMES_DESKTOP_BOOT_FAKE and is
  // not what this probe is about.
  if (/ECONNREFUSED|WebSocket|gateway|Failed to fetch|net::ERR/i.test(text)) {
    return
  }

  consoleErrors.push(`console: ${text.slice(0, 200)}`)
})

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
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/** Text a user can actually read, from the canvas only. */
const canvasText = () =>
  page.evaluate(() => (document.querySelector('main') ?? document.body).innerText ?? '')

const LEAKS = [
  ['undefined', /\bundefined\b/],
  ['null', /(^|[\s>[({:,])null([\s<\])},.]|$)/],
  ['NaN', /\bNaN\b/],
  ['[object Object]', /\[object [A-Z]\w+\]/],
  ['Invalid Date', /Invalid Date/],
  ['unresolved template placeholder', /\{\{\s*\w+\s*\}\}/]
]

async function sweep(label) {
  const text = await canvasText()

  for (const [name, pattern] of LEAKS) {
    const hit = pattern.exec(text)

    // Templates legitimately display their own placeholders as source text —
    // that is the file's real content, not a rendering failure.
    if (hit && !(name === 'unresolved template placeholder' && /Template/i.test(label))) {
      check(`${label}: no "${name}" on screen`, false, `…${text.slice(Math.max(0, hit.index - 45), hit.index + 45).replace(/\n+/g, ' ')}…`)

      return
    }
  }

  check(`${label}: renders clean`, text.trim().length > 20, `${text.trim().length} chars`)
}

const open = async name => {
  await page.locator('aside button', { hasText: name }).last().click()
  await page.waitForTimeout(1600)
}

console.log('--- every screen, looking for raw JS on the page ---')

await page.locator('aside button', { hasText: 'Home' }).first().click()
await page.waitForTimeout(1800)
await sweep('Home')

for (const name of ['Notes', 'Todo', 'Calendar', 'Money', 'Meetings', 'Mail']) {
  await open(name)
  await sweep(name)
}

console.log('--- notes with awkward frontmatter ---')

for (const title of ['Linear Algebra', 'Assignment 2', 'Lecture Template']) {
  await page.locator('aside button', { hasText: title }).last().click()
  await page.waitForTimeout(1400)
  await sweep(`Note "${title}"`)
}

console.log('--- money arithmetic ---')
await open('Money')

const money = await canvasText()

// 4200 in, 1884.20 out, 2315.80 net. Formatting varies; the digits must not.
check('income is totalled', /4,?200/.test(money), money.slice(0, 90).replace(/\n+/g, ' '))
check('spend is totalled', /1,?884/.test(money))
check('net is totalled', /2,?315/.test(money))

console.log('--- accessible names on icon-only controls ---')

const nameless = await page.evaluate(() =>
  [...document.querySelectorAll('button')]
    .filter(button => {
      if (!button.offsetParent) {
        return false
      }

      const labelled =
        (button.textContent ?? '').trim() ||
        button.getAttribute('aria-label') ||
        button.getAttribute('title') ||
        button.querySelector('[aria-label], title')

      return !labelled
    })
    .map(button => button.className.toString().slice(0, 70))
    .slice(0, 8)
)

check('every visible button has an accessible name', nameless.length === 0, nameless.join(' | '))

console.log('--- console ---')
check('no console errors across the sweep', consoleErrors.length === 0, consoleErrors.slice(0, 4).join(' | '))

await app.close()

console.log(failures.length ? `\nRESULT: ${failures.length} FAILED` : '\nRESULT: ALL CHECKS PASSED')
process.exit(failures.length ? 1 : 0)
