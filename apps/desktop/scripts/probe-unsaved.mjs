#!/usr/bin/env node
/**
 * Writing that could not be saved has to survive the click that leaves the note.
 *
 * Switching notes must drop the pending buffer — otherwise the old note's text
 * gets written into the new note's file, which is its own old bug. But the
 * flush before that drop is allowed to fail: a read-only volume, an unplugged
 * drive, an iCloud note still coming down. When it did, the buffer was cleared
 * anyway and the writing was gone. Nothing said so; the dirty dot simply moved
 * on with the note the user had just opened.
 *
 * A read-only vault directory stands in for all of those: reads work, and
 * every write fails at the temp file.
 *
 * Usage: node scripts/probe-unsaved.mjs   (needs `npm run build` first)
 */

import { _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

if (process.getuid?.() === 0) {
  console.error('Run this as a normal user: root writes to read-only directories.')
  process.exit(1)
}

const DESKTOP_ROOT = path.resolve(import.meta.dirname, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'daat-unsaved-'))
const home = path.join(tmp, 'home')
const vault = path.join(tmp, 'vault')
const userData = path.join(tmp, 'userData')

for (const dir of [home, vault, userData]) {
  fs.mkdirSync(dir, { recursive: true })
}

const TYPED = 'The paragraph I actually wrote.'

fs.writeFileSync(path.join(vault, 'Alpha.md'), '# Alpha\n\n', 'utf8')
fs.writeFileSync(path.join(vault, 'Beta.md'), '# Beta\n\nBeta stays as it is.\n', 'utf8')
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

console.log('--- typing into a note the disk will not accept ---')

await page.locator('aside button', { hasText: 'Alpha' }).last().click()
await page.waitForTimeout(1500)

// Reads still work; every write fails creating its temp file.
fs.chmodSync(vault, 0o500)

await page.locator('main .cm-content').first().click()
await page.keyboard.press('End')
await page.keyboard.type(TYPED)
// Past the 1s debounce and the first backoff retry.
await page.waitForTimeout(5000)

check('the save is reported as failing', /Couldn't save|저장하지 못/.test(await page.evaluate(() => document.body.innerText)))

console.log('\n--- and then leaving it for another note ---')

await page.locator('aside button', { hasText: 'Beta' }).last().click()
await page.waitForTimeout(2500)

const body = await page.evaluate(() => document.body.innerText)

check('it says another note still holds unsaved text', /never reached disk|저장되지 않은 노트/.test(body))
check('the note left behind was not written', !fs.readFileSync(path.join(vault, 'Alpha.md'), 'utf8').includes(TYPED))

console.log('\n--- the volume comes back, the note is reopened ---')

fs.chmodSync(vault, 0o700)

await page.locator('aside button', { hasText: 'Alpha' }).last().click()
await page.waitForTimeout(1500)

const shown = await page.evaluate(() => document.querySelector('main .cm-content')?.textContent ?? '')

check('the editor has the text back', shown.includes(TYPED), JSON.stringify(shown.slice(0, 60)))

await page.waitForTimeout(4000)

const onDisk = fs.readFileSync(path.join(vault, 'Alpha.md'), 'utf8')

check('and it finally reaches disk', onDisk.includes(TYPED), JSON.stringify(onDisk.slice(0, 60)))
check(
  'the note it was parked next to is untouched',
  fs.readFileSync(path.join(vault, 'Beta.md'), 'utf8') === '# Beta\n\nBeta stays as it is.\n'
)

await app.close()
await new Promise(resolve => setTimeout(resolve, 1000))

try {
  fs.chmodSync(vault, 0o700)
  fs.rmSync(tmp, { force: true, maxRetries: 5, recursive: true, retryDelay: 300 })
} catch {
  // A leftover temp directory is not worth failing a run over.
}

console.log(failures.length ? `\nRESULT: ${failures.length} FAILED` : '\nRESULT: unsaved writing survives the note switch')
process.exit(failures.length ? 1 : 0)
