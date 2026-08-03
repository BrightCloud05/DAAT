#!/usr/bin/env node
/**
 * ⌘D — today's note, with its template actually in it.
 *
 * A real vault held `Daily/2026-07-29.md` containing exactly `# 2026-07-29`,
 * which is the seed createNote writes and nothing else. `Templates/Daily.md`
 * sat right there, unused.
 *
 * The interesting part is the shape of that failure. openDailyNote switches the
 * canvas to the editor and then replaces the document with the filled template,
 * so it has to wait for the editor pane to mount — waitForEditor does that, and
 * on timeout returns null and RETURNS. No template, no error, no log line. The
 * user gets a blank note and no reason.
 *
 * So the case that matters is ⌘D pressed from a screen where the editor is not
 * mounted, which is most of them: Home, Todo, Calendar, the table. Pressing it
 * while already in the editor proves nothing — the view is there before the
 * wait begins.
 *
 * Usage: node scripts/probe-daily-note.mjs   (needs `npm run build` first)
 */

import { _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DESKTOP_ROOT = path.resolve(import.meta.dirname, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'daat-daily-'))
const home = path.join(tmp, 'home')
const vault = path.join(tmp, 'vault')
const userData = path.join(tmp, 'userData')

for (const dir of [home, vault, userData, path.join(vault, 'Templates')]) {
  fs.mkdirSync(dir, { recursive: true })
}

const TEMPLATE = ['---', 'date: "{{date}}"', '---', '', '## Today', '', '- [ ]', '', '## Notes', ''].join('\n')

fs.writeFileSync(path.join(vault, 'Templates', 'Daily.md'), TEMPLATE, 'utf8')
fs.writeFileSync(path.join(vault, 'Anchor.md'), '# Anchor\n\nsomething to open\n', 'utf8')
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

const dailyFile = () => {
  const dir = path.join(vault, 'Daily')

  if (!fs.existsSync(dir)) {
    return null
  }

  const names = fs.readdirSync(dir).filter(name => name.endsWith('.md'))

  return names.length ? { name: names[0], body: fs.readFileSync(path.join(dir, names[0]), 'utf8') } : null
}

// Home: the editor pane is not mounted. This is the path that failed.
console.log("--- ⌘D from Home, where the editor isn't mounted ---")
await page.locator('aside button', { hasText: 'Home' }).last().click()
await page.waitForTimeout(1500)
await page.keyboard.press('ControlOrMeta+d')
await page.waitForTimeout(4000)

const created = dailyFile()

check("today's note was created", Boolean(created), created?.name ?? 'no Daily/ directory')

if (created) {
  console.log(`   ${created.body.length} bytes: ${JSON.stringify(created.body.slice(0, 60))}`)

  check('the template was applied, not just the seed', created.body.includes('## Today'), created.body.slice(0, 40).replace(/\n/g, '\\n'))
  check('the checklist came with it', created.body.includes('- [ ]'))
  check('the date placeholder was filled', !created.body.includes('{{date}}'))
  check(
    'the frontmatter is a mapping, not a nested one',
    !/date:\s*\{/.test(created.body),
    'an unquoted {{date}} is YAML flow-mapping syntax and parses to an object'
  )
}

// Pressing it again must open the same note, not overwrite what is in it.
console.log('\n--- ⌘D again, with work already in the note ---')
const dir = path.join(vault, 'Daily')
const name = fs.readdirSync(dir)[0]

fs.writeFileSync(path.join(dir, name), '# mine\n\nreal work I typed\n', 'utf8')
await page.waitForTimeout(1500)
await page.locator('aside button', { hasText: 'Home' }).last().click()
await page.waitForTimeout(1200)
await page.keyboard.press('ControlOrMeta+d')
await page.waitForTimeout(4000)

const after = fs.readFileSync(path.join(dir, name), 'utf8')

check('an existing note is not overwritten by the template', after.includes('real work I typed'), after.slice(0, 50).replace(/\n/g, '\\n'))

await app.close()
fs.rmSync(tmp, { recursive: true, force: true })

console.log(failures.length ? `\nRESULT: ${failures.length} FAILED` : '\nRESULT: ALL CHECKS PASSED')
process.exit(failures.length ? 1 : 0)
