#!/usr/bin/env node
/**
 * What "New page" actually leaves on disk.
 *
 * createNote seeds `# <title>\n\n`, so every new page should arrive with its
 * own heading. A real vault had `Untitled 2.md` and `Untitled 3.md` holding
 * theirs and `Untitled.md` sitting at zero bytes — same button, same session,
 * different result.
 *
 * The suspicion worth testing is a race rather than a typo: createNote writes
 * the seed, the editor adopts the new note, and the debounced save fires with
 * whatever the editor holds. If the view is still empty at that moment it
 * writes emptiness back over the seed. That would bite hardest on the FIRST
 * page created in a session, when the editor pane has never mounted.
 *
 * Both entry points are exercised because there are two of them: ⌘N in the
 * shell and the sidebar button, each with its own copy of the naming rule.
 *
 * Usage: node scripts/probe-new-page.mjs   (needs `npm run build` first)
 */

import { _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DESKTOP_ROOT = path.resolve(import.meta.dirname, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'daat-newpage-'))
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

console.log('--- ⌘N, three times, from a vault with nothing in it ---')

for (let i = 0; i < 3; i += 1) {
  await page.keyboard.press('ControlOrMeta+n')
  // Longer than the 1s save debounce, so a save that would clobber the seed
  // has had its chance to land.
  await page.waitForTimeout(2500)
}

console.log('--- and once from the sidebar button ---')
await page.locator('aside button', { hasText: 'New page' }).first().click()
await page.waitForTimeout(2500)

const files = fs
  .readdirSync(vault)
  .filter(name => name.endsWith('.md'))
  .sort()

console.log('\n--- on disk ---')

for (const name of files) {
  const body = fs.readFileSync(path.join(vault, name), 'utf8')

  console.log(`   ${String(body.length).padStart(4)} bytes  ${name.padEnd(18)} ${JSON.stringify(body.slice(0, 30))}`)
}

check('four pages were created', files.length === 4, `${files.length}: ${files.join(', ')}`)

const empty = files.filter(name => fs.readFileSync(path.join(vault, name), 'utf8').trim() === '')

check('none of them is empty', empty.length === 0, empty.length ? `empty: ${empty.join(', ')}` : '')

const titled = files.filter(name => {
  const body = fs.readFileSync(path.join(vault, name), 'utf8')

  return body.startsWith(`# ${name.replace(/\.md$/, '')}`)
})

check('each one carries its own title', titled.length === files.length, `${titled.length}/${files.length}`)

const names = new Set(files)

check('the names do not collide', names.size === files.length)

await app.close()
fs.rmSync(tmp, { recursive: true, force: true })

console.log(failures.length ? `\nRESULT: ${failures.length} FAILED` : '\nRESULT: ALL CHECKS PASSED')
process.exit(failures.length ? 1 : 0)
