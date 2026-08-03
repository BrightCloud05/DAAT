#!/usr/bin/env node
/**
 * Live preview, on the notes the app itself generates.
 *
 * The contract is not "hide every mark". Live preview reveals the source on the
 * lines the selection touches, so you can edit what is actually in the file —
 * the same bargain Obsidian makes. A screenshot of a note mid-selection there-
 * fore shows raw '##' on exactly those lines, and that is correct.
 *
 * Which makes the useful test a pair, not a single assertion: marks hidden
 * where the selection is not, and revealed where it is. Checking only the first
 * half calls the cursor's own line a bug; checking only the second half misses
 * a preview that never renders at all.
 *
 * Usage: node scripts/probe-live-preview.mjs   (needs `npm run build` first)
 */

import { _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DESKTOP_ROOT = path.resolve(import.meta.dirname, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'daat-preview-'))
const home = path.join(tmp, 'home')
const vault = path.join(tmp, 'vault')
const userData = path.join(tmp, 'userData')

for (const dir of [home, vault, userData]) {
  fs.mkdirSync(dir, { recursive: true })
}

const FRONTMATTER = ['---', 'type: course', 'code: BUSA3020', 'term:', 'teacher:', 'room:', 'days: []', 'time:', '---', ''].join('\n')

const BODY = ['# BUSA3020', '', '## Lectures', '', '## Key terms', '', '## Assessments', '', '## Notes to review', '', '- [ ]', '', '## Unclear / Questions', '', '- [ ]', ''].join('\n')

// One variable removed per case.
const CASES = [
  { name: 'A-real-note', text: FRONTMATTER + BODY },
  { name: 'B-no-frontmatter', text: BODY },
  { name: 'C-no-checkboxes', text: FRONTMATTER + BODY.replace(/- \[ \]\n/g, '') },
  { name: 'D-headings-only', text: ['## One', '', '## Two', '', '## Three', '', '## Four', '', '## Five', '', '## Six', ''].join('\n') }
]

for (const testCase of CASES) {
  fs.writeFileSync(path.join(vault, `${testCase.name}.md`), testCase.text, 'utf8')
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

for (const testCase of CASES) {
  await page.locator('aside button', { hasText: testCase.name }).last().click()
  await page.waitForTimeout(1800)

  // What the user actually sees. A heading whose marks are hidden shows no '#'.
  const lines = await page.evaluate(() =>
    [...document.querySelectorAll('.cm-content .cm-line')].map(line => line.textContent ?? '')
  )

  const headings = lines.filter(line => /\w/.test(line) && !line.startsWith('---') && !line.includes(':'))
  const raw = headings.filter(line => line.trimStart().startsWith('#'))

  console.log(`\n--- ${testCase.name} ---`)

  for (const line of headings) {
    console.log(`   ${line.trimStart().startsWith('#') ? 'raw ' : 'ok  '} ${line.slice(0, 46)}`)
  }

  // On open the cursor sits at position 0, so exactly one line — the first —
  // is allowed to show its marks. Every other heading must be rendered.
  if (raw.length > 1) {
    failures.push(`${testCase.name}: ${raw.length} headings raw, only the cursor's line may be`)
  }

  if (!headings.length) {
    failures.push(`${testCase.name}: nothing rendered at all`)
  }

  // Now put the selection over the whole document: the marks must come BACK,
  // or the text you are about to edit is not the text in the file.
  await page.locator('.cm-content').first().click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.waitForTimeout(600)

  const selected = await page.evaluate(() =>
    [...document.querySelectorAll('.cm-content .cm-line')].map(line => line.textContent ?? '')
  )
  const revealed = selected.filter(line => line.trimStart().startsWith('#') && /\w/.test(line))

  console.log(`   selection reveals ${revealed.length}/${headings.length} heading marks`)

  if (revealed.length < headings.length) {
    failures.push(`${testCase.name}: selecting all revealed only ${revealed.length} of ${headings.length}`)
  }
}

console.log('')
await app.close()
fs.rmSync(tmp, { recursive: true, force: true })

if (failures.length) {
  console.log(`RESULT: ${failures.length} FAILED`)

  for (const failure of failures) {
    console.log(`  ${failure}`)
  }
} else {
  console.log('RESULT: ALL CHECKS PASSED')
}

process.exit(failures.length ? 1 : 0)
