#!/usr/bin/env node
/**
 * The inline assistant, driven through the real UI of the built app.
 *
 * WHAT THIS COVERS
 *
 * Everything between the keystroke and the gateway call: the ⌘I keymap sees the
 * selection, the overlay opens in EDIT mode (its actions are phrased as edits —
 * write-mode wording sends the model looking in the wrong place), "Make
 * shorter" reaches runInlineAi, and a run that cannot reach a backend SAYS SO.
 *
 * That last one is a fix being pinned down: an `error` frame used to be
 * swallowed whole, which made a failed run look exactly like a run that decided
 * to change nothing — the same silence the 1.5s teardown bug produced. Silence
 * is the failure mode this feature keeps having, so silence is what gets tested.
 *
 * WHAT THIS DOES NOT COVER
 *
 * A real model call. There is no backend here, so nothing verifies that a
 * provider's answer lands in the document — inline-ai-run.test.ts covers that
 * against the gateway's documented contract, and only a live provider can
 * settle it for real.
 *
 * Usage: node scripts/probe-inline-ai.mjs   (needs `npm run build` first)
 */

import { _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DESKTOP_ROOT = path.resolve(import.meta.dirname, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'daat-inline-ai-'))
const home = path.join(tmp, 'home')
const vault = path.join(tmp, 'vault')
const userData = path.join(tmp, 'userData')

for (const dir of [home, vault, userData]) {
  fs.mkdirSync(dir, { recursive: true })
}

const PASSAGE =
  'The quarterly report was written by the team over several weeks and it contains a great many details.'

fs.writeFileSync(path.join(vault, 'Draft.md'), `# Draft\n\n${PASSAGE}\n`, 'utf8')
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

console.log('--- open a note and select the passage ---')
await page.locator('aside button', { hasText: 'Draft' }).last().click()
await page.waitForTimeout(1500)

const editor = page.locator('.cm-content').first()
check('the editor is showing the note', await editor.isVisible())

await editor.click()
await page.keyboard.press('ControlOrMeta+a')
await page.waitForTimeout(300)

const selected = await page.evaluate(() => String(window.getSelection() ?? ''))

check('the passage is selected', selected.includes('quarterly report'), `${selected.length} chars`)

console.log('\n--- the ⌘I affordance ---')
await page.keyboard.press('ControlOrMeta+i')
await page.waitForTimeout(700)

const overlay = await page.locator('[data-inline-ai]').first().innerText().catch(() => '')

check('the overlay opened', /make shorter/i.test(overlay), overlay.slice(0, 100).replace(/\n+/g, ' '))
check(
  'it offers edit actions, not write actions',
  /improve writing/i.test(overlay) && /make longer/i.test(overlay),
  'selection mode must phrase its actions as edits'
)
check('translation is offered too', /한국어|translate/i.test(overlay))

console.log('\n--- clicking Make shorter with no backend reachable ---')
const before = await editor.innerText()

await page.locator('button', { hasText: /^Make shorter$/ }).first().click()

// Give the run long enough to fail and report. The bug this guards against is
// the opposite of slow: it closed instantly and said nothing.
await page.waitForTimeout(6000)

const after = await editor.innerText()

check('the note was not silently mangled', after.includes('quarterly report'), `${after.length} chars`)

// Either it is still working, or it explained itself. What it must not do is
// vanish leaving the note untouched and the user with no idea why.
//
// Matched against the OVERLAY, not the whole page: the sidebar and settings
// contain words like "error" all on their own, and a probe that greps the body
// for them passes whether or not the feature said anything. That is the same
// false pass that made a blocked CSP look like a clean one.
const bubble = await page
  .locator('[data-inline-ai]')
  .first()
  .innerText()
  .catch(() => '')

const stillRunning = /stop|generating|thinking/i.test(bubble)
const explained = /not connected|stopped responding|failed|could not|error/i.test(bubble)
const matched = /(not connected|stopped responding|failed|could not|error|stop|generating|thinking)/i.exec(bubble)

check(
  'a run that cannot reach the agent says so, in the overlay',
  stillRunning || explained,
  bubble ? `overlay says: "${bubble.replace(/\n+/g, ' ').slice(0, 90)}" (matched: ${matched?.[0] ?? 'nothing'})` : 'no overlay found on screen'
)

check('nothing was written from a run that never answered', before === after)

console.log('\n--- console ---')
check('no uncaught exceptions', crashes.length === 0, crashes.slice(0, 3).join(' | '))

await app.close()
fs.rmSync(tmp, { recursive: true, force: true })

console.log(failures.length ? `\nRESULT: ${failures.length} FAILED` : '\nRESULT: ALL CHECKS PASSED')
process.exit(failures.length ? 1 : 0)
