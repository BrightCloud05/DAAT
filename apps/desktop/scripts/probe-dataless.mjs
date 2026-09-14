#!/usr/bin/env node
/**
 * The note you cannot read must be the note you cannot destroy.
 *
 * The default vault lives in iCloud, and the default macOS setting is
 * "Optimize Mac Storage", which evicts the contents of files you have not
 * opened lately. An evicted note still stats fine — only reading it blocks —
 * so it arrived in the editor as an EMPTY document carrying its real mtime.
 *
 * From there every guard agreed the write was safe: the mtime matched, and the
 * byte comparison had no bytes to compare. One keystroke in that empty
 * document, one second of autosave, and the note became what the user had just
 * typed. iCloud then carried that to every device.
 *
 * The unit tests pin the rule in vault-fs. This runs the whole chain in the
 * real app — read, index, editor, autosave — against a note the process
 * genuinely cannot read. chmod 000 stands in for eviction: what matters is
 * that the bytes are unavailable, not why.
 *
 * Usage: node scripts/probe-dataless.mjs   (needs `npm run build` first)
 */

import { _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

if (process.getuid?.() === 0) {
  console.error('Run this as a normal user: root reads mode-000 files, so nothing would be unreadable.')
  process.exit(1)
}

const DESKTOP_ROOT = path.resolve(import.meta.dirname, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'daat-dataless-'))
const home = path.join(tmp, 'home')
const vault = path.join(tmp, 'vault')
const userData = path.join(tmp, 'userData')

for (const dir of [home, vault, userData]) {
  fs.mkdirSync(dir, { recursive: true })
}

const EVICTED = path.join(vault, 'Evicted.md')
const REAL = '# Evicted\n\nEight hundred words that took a Sunday to write.\n'

fs.writeFileSync(EVICTED, REAL, 'utf8')
fs.writeFileSync(path.join(vault, 'Normal.md'), '# Normal\n\nStill here.\n', 'utf8')

// The legacy eviction form: the note exists only as a placeholder plist. Every
// other part of the vault treats it as a present-but-dataless note; the indexer
// used to see ENOENT and delete the row, so it vanished from search and the
// tree the moment iCloud reclaimed its bytes.
fs.writeFileSync(path.join(vault, '.Placeheld.md.icloud'), 'plist', 'utf8')
fs.writeFileSync(path.join(userData, 'vault.json'), JSON.stringify({ root: vault }), 'utf8')

// Evicted: present, stat-able, unreadable.
fs.chmodSync(EVICTED, 0o000)

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

console.log('--- opening a note whose contents are not local ---')

await page.locator('aside button', { hasText: 'Evicted' }).last().click()
// readNote spends its 4s timeout, then tries `brctl download`, before it
// concludes the note is dataless.
await page.waitForTimeout(8000)

const state = await page.evaluate(() => ({
  doc: document.querySelector('main .cm-content')?.textContent ?? null,
  body: document.body.innerText
}))

check('the note opened', state.doc !== null)
check('it says the contents are still coming down', /iCloud/i.test(state.body), state.body.match(/.*iCloud.*/i)?.[0] ?? '')

console.log('\n--- typing into it ---')

await page.locator('main .cm-content').first().click()
await page.keyboard.type('this is not the note')
// Well past the 1s save debounce and the first retry.
await page.waitForTimeout(6000)

fs.chmodSync(EVICTED, 0o644)

const onDisk = fs.readFileSync(EVICTED, 'utf8')

// Evicted again for the index checks below.
fs.chmodSync(EVICTED, 0o000)

check('the Sunday is still on disk', onDisk === REAL, `${onDisk.length} bytes: ${JSON.stringify(onDisk.slice(0, 40))}`)
check('and the typing never landed in it', !onDisk.includes('this is not the note'))
check(
  'the editor refused the keystrokes',
  !(await page.evaluate(() => document.querySelector('main .cm-content')?.textContent ?? '')).includes(
    'this is not the note'
  )
)

console.log('\n--- a placeholder-only note is still a note ---')

const sidebar = await page.evaluate(() => document.querySelector('aside')?.innerText ?? '')

check('the placeholder-backed note is listed', sidebar.includes('Placeheld'), sidebar.split('\n').slice(0, 12).join(' / '))

console.log('\n--- and once iCloud sends the contents, they become searchable ---')

fs.chmodSync(EVICTED, 0o644)

await page.evaluate(() => window.hermesDesktop.vault.reindex())
await page.waitForTimeout(6000)

const hits = await page.evaluate(() => window.hermesDesktop.vault.search('Sunday'))

check('the once-evicted note is searchable', hits.length > 0, JSON.stringify(hits.map(hit => hit.path)))

console.log('\n--- and the note beside it is unaffected ---')

await page.locator('aside button', { hasText: 'Normal' }).last().click()
await page.waitForTimeout(1500)
await page.locator('main .cm-content').first().click()
// Not a leading space: the note ends in a newline, so the click lands on the
// empty final line, and Space there is the inline-AI gesture — which would
// swallow the rest of this and make a working save look broken.
await page.keyboard.type('Edited.')
await page.waitForTimeout(3000)

check('a readable note still saves', fs.readFileSync(path.join(vault, 'Normal.md'), 'utf8').includes('Edited.'))

await app.close()
await new Promise(resolve => setTimeout(resolve, 1000))

try {
  fs.rmSync(tmp, { force: true, maxRetries: 5, recursive: true, retryDelay: 300 })
} catch {
  // A leftover temp directory is not worth failing a run over.
}

console.log(failures.length ? `\nRESULT: ${failures.length} FAILED` : '\nRESULT: an unreadable note survives being typed into')
process.exit(failures.length ? 1 : 0)
