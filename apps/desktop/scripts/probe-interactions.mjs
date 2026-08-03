#!/usr/bin/env node
/**
 * The parts of the app you click, checked by their effect rather than their pixels.
 *
 * Every screen was already known to render without throwing (probe-audit), which
 * is a much weaker claim than it sounds: a checkbox that toggles in the UI and
 * never reaches the file looks identical to one that works, right up until the
 * user reopens the note. Same for a search result that highlights but opens
 * nothing, or a wikilink that is styled like a link and isn't one.
 *
 * So each case here ends at an observable consequence — bytes on disk, or the
 * note that is now on screen — and never at "the element exists".
 *
 * Usage: node scripts/probe-interactions.mjs   (needs `npm run build` first)
 */

import { _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DESKTOP_ROOT = path.resolve(import.meta.dirname, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'daat-interact-'))
const home = path.join(tmp, 'home')
const vault = path.join(tmp, 'vault')
const userData = path.join(tmp, 'userData')

for (const dir of [home, vault, userData]) {
  fs.mkdirSync(dir, { recursive: true })
}

const today = new Date().toISOString().slice(0, 10)

const NOTES = {
  'Tasks.md': `# Tasks\n\n- [ ] buy the milk\n- [ ] call the plumber\n`,
  'Hub.md': `# Hub\n\nSee [[Target]] for the details.\n`,
  'Target.md': `# Target\n\nthe destination note\n`,
  'Dated.md': `---\ndue: ${today}\n---\n\n# Dated\n\n- [ ] something due today\n`,
  'Haystack.md': `# Haystack\n\nzzquixotic is a word that appears exactly once.\n`
}

for (const [name, body] of Object.entries(NOTES)) {
  fs.writeFileSync(path.join(vault, name), body, 'utf8')
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
const crashes = []

page.on('pageerror', error => crashes.push(error.message.slice(0, 160)))

const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)

  if (!ok) {
    failures.push(label)
  }
}

const read = name => fs.readFileSync(path.join(vault, name), 'utf8')
const canvas = () => page.evaluate(() => document.querySelector('main')?.innerText ?? '')
const nav = async name => {
  await page.locator('aside button', { hasText: name }).last().click()
  await page.waitForTimeout(1500)
}

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

console.log('--- Todo: does ticking a box reach the file? ---')
await nav('Todo')

const todoScreen = await canvas()

check('the todos were found', /buy the milk/i.test(todoScreen), todoScreen.slice(0, 90).replace(/\n+/g, ' '))

// The tick box is a button holding nothing but an SVG, and the label lives in
// a sibling span — so it has to be found through the row, not by its text.
const milkRow = page.locator('main div').filter({ hasText: /^buy the milk/ }).last()
const milk = milkRow.locator('button').first()

if (await milk.count()) {
  await milk.click()
  await page.waitForTimeout(2500)

  const body = read('Tasks.md')

  check('the file now records it as done', /- \[x\] buy the milk/i.test(body), JSON.stringify(body.slice(10, 60)))
  check('the other task was left alone', /- \[ \] call the plumber/.test(body))
} else {
  check('a todo can be clicked', false, 'no clickable todo row found')
}

console.log('\n--- Search: does a result open the note? ---')
const search = page.locator('aside input').first()

if (await search.count()) {
  await search.fill('zzquixotic')
  await page.waitForTimeout(2000)

  const hits = await page.evaluate(() => document.querySelector('aside')?.innerText ?? '')

  check('the rare word is found', /haystack/i.test(hits), hits.slice(0, 110).replace(/\n+/g, ' '))

  const hit = page.locator('aside button', { hasText: 'Haystack' }).last()

  if (await hit.count()) {
    await hit.click()
    await page.waitForTimeout(1800)
    check('clicking the result opens that note', (await canvas()).includes('zzquixotic'))
  } else {
    check('the result is clickable', false)
  }

  await search.fill('')
  await page.waitForTimeout(1000)
} else {
  check('there is a search box', false)
}

console.log('\n--- Wikilink: does [[Target]] navigate? ---')
await nav('Hub')

// There is no anchor to click. The link is a Lezer tag and navigation is a
// mousedown handler that asks what is at the coordinates — so the test has to
// click the rendered word, exactly as a person does.
//
// Plain click is enough here because the cursor lands on line 1 when the note
// opens; a modifier is only required on the link's own line, where a click
// means "edit this".
const link = page.locator('.cm-content').getByText('Target', { exact: true }).first()

if (await link.count()) {
  await link.click()
  await page.waitForTimeout(2000)

  const landed = await canvas()

  check('following the link lands on Target', landed.includes('the destination note'), landed.slice(0, 70).replace(/\n+/g, ' '))
} else {
  check('the wikilink renders as clickable text', false, 'no "Target" text inside the document')
}

console.log('\n--- Backlinks: does Target know Hub points at it? ---')
const backlinkRow = page.locator('button, summary', { hasText: /backlink/i }).first()

if (await backlinkRow.count()) {
  await backlinkRow.click()
  await page.waitForTimeout(1200)
}

check('Hub is listed as a backlink of Target', /hub/i.test(await canvas()), (await canvas()).slice(-110).replace(/\n+/g, ' '))

console.log('\n--- Calendar: does a dated note show up? ---')
await nav('Calendar')
check('the note due today is on the calendar', /dated|something due/i.test(await canvas()), (await canvas()).slice(0, 110).replace(/\n+/g, ' '))

// The graph is a canvas laid out by a live force simulation, so a node is
// wherever the simulation happens to have put it this run. Clicking one from
// here would mean either reading the simulation's own state — which tests the
// test — or clicking blind and calling a miss a failure.
//
// So this checks only that the graph mounts and draws. Whether clicking a node
// opens its note is NOT covered by anything, and stays a manual check.
console.log('\n--- Graph: does it mount and draw? (clicking a node is not covered) ---')
await nav('Graph')
await page.waitForTimeout(2500)

const drawn = await page.evaluate(() => {
  const canvas = document.querySelector('main canvas')

  if (!canvas) {
    return { found: false, painted: false }
  }

  // A canvas that mounted but never painted is the failure worth catching: it
  // looks exactly like an empty vault.
  const context = canvas.getContext('2d')
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
  let painted = false

  for (let i = 3; i < data.length; i += 4000) {
    if (data[i] !== 0) {
      painted = true
      break
    }
  }

  return { found: true, painted, size: `${canvas.width}x${canvas.height}` }
})

check('the graph canvas mounted', drawn.found)
check('and actually painted something', drawn.painted, drawn.size ?? '')

console.log('\n--- nothing crashed ---')
check('no uncaught exceptions', crashes.length === 0, crashes.slice(0, 3).join(' | '))

await app.close()
fs.rmSync(tmp, { recursive: true, force: true })

console.log(failures.length ? `\nRESULT: ${failures.length} FAILED` : '\nRESULT: ALL CHECKS PASSED')
process.exit(failures.length ? 1 : 0)
