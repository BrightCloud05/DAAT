#!/usr/bin/env node
/**
 * The scenario nobody had tested: someone who installed weeks ago opens a new build.
 *
 * Daat lives in two places — the app in /Applications and the Python agent in
 * ~/.daat/hermes-agent — and dragging a new DMG over the old one replaces only
 * the first. Nothing compared their versions, so an existing user got the new
 * interface driving the old agent, with none of its new tools and no sign that
 * anything was mismatched.
 *
 * The unit tests in electron/agent-source.test.ts cover the rules for when a
 * refresh may happen. They cannot tell you whether the app actually calls it,
 * with the right two paths, inside a packaged build. That is what this does:
 * it fabricates an install from an older bundle, launches the REAL .app, and
 * looks for a file that only the new bundle has.
 *
 * Usage: node scripts/probe-update.mjs   (needs `npm run dist:mac:dmg` first)
 */

import { _electron as electron } from '@playwright/test'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DESKTOP_ROOT = path.resolve(import.meta.dirname, '..')
const APP = path.join(DESKTOP_ROOT, 'release', 'mac-arm64', 'Daat.app', 'Contents', 'MacOS', 'Daat')
const BUNDLE = path.join(
  DESKTOP_ROOT,
  'release/mac-arm64/Daat.app/Contents/Resources/app.asar.unpacked/dist/agent-src'
)

// A file this build has and last week's did not. If the refresh works, it
// appears in an install that never had it.
const NEW_FILE = 'plugins/mail/reply.py'
const STAMP = '.daat-bundle-stamp'
const BUNDLE_ID = '.daat-bundle-id'

for (const [label, target] of [
  ['packaged app', APP],
  ['bundled agent source', path.join(BUNDLE, 'pyproject.toml')],
  ['the new file to look for', path.join(BUNDLE, NEW_FILE)]
]) {
  if (!fs.existsSync(target)) {
    console.error(`Missing ${label}: ${target}\nRun \`ALLOW_UNSIGNED=1 npm run dist:mac:dmg\` first.`)
    process.exit(1)
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'daat-update-'))
const home = path.join(tmp, 'home')
const installed = path.join(home, 'hermes-agent')
const vault = path.join(tmp, 'vault')
const userData = path.join(tmp, 'userData')

for (const dir of [home, vault, userData]) {
  fs.mkdirSync(dir, { recursive: true })
}

fs.writeFileSync(path.join(vault, 'A note.md'), '# A note\n', 'utf8')
fs.writeFileSync(path.join(userData, 'vault.json'), JSON.stringify({ root: vault }), 'utf8')

console.log('--- fabricating last week’s install ---')

// Copy the current bundle, then take away what is new. What is left is a
// faithful older install: same shape, missing this week's work.
fs.cpSync(BUNDLE, installed, { recursive: true })
fs.rmSync(path.join(installed, NEW_FILE), { force: true })
fs.rmSync(path.join(installed, BUNDLE_ID), { force: true })

// A REAL venv, borrowed from the live install.
//
// A fabricated one does not work here: the app only takes the fast path when
// classifyActiveRuntime says the runtime is usable, and a text file named
// `python` is not. With a fake venv the app stops at the setup screen and the
// refresh is never reached — which looked exactly like the refresh being
// broken, and cost an hour of chasing the wrong thing.
const liveVenv = path.join(os.homedir(), '.daat', 'hermes-agent', 'venv')

if (!fs.existsSync(path.join(liveVenv, 'bin', 'hermes'))) {
  console.error(`No usable venv to borrow at ${liveVenv}. This probe needs one real install on the machine.`)
  process.exit(1)
}

console.log('   borrowing the live venv so the runtime counts as usable…')
fs.cpSync(liveVenv, path.join(installed, 'venv'), { recursive: true, verbatimSymlinks: true })

fs.writeFileSync(path.join(installed, 'my-own-file.txt'), 'do not touch', 'utf8')

// The marker that says "a real install finished here".
fs.writeFileSync(
  path.join(installed, '.hermes-bootstrap-complete'),
  JSON.stringify({ schemaVersion: 1, pinnedCommit: 'aaaaaaaaaaaa' }),
  'utf8'
)

// Stamp it the way a seed would have, with an id that is NOT this bundle's.
const owned = []
const walk = (dir, prefix) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['venv', '__pycache__', '.git'].includes(entry.name) || entry.name.endsWith('.pyc')) {
      continue
    }

    if (!prefix && (entry.name === STAMP || entry.name === BUNDLE_ID)) {
      continue
    }

    const rel = prefix ? `${prefix}/${entry.name}` : entry.name

    entry.isDirectory() ? walk(path.join(dir, entry.name), rel) : owned.push(rel)
  }
}

walk(installed, '')

const files = Object.fromEntries(
  owned
    .filter(rel => rel !== 'my-own-file.txt')
    .map(rel => [rel, crypto.createHash('sha1').update(fs.readFileSync(path.join(installed, rel))).digest('hex')])
)

fs.writeFileSync(
  path.join(installed, STAMP),
  JSON.stringify({ version: 1, bundle: 'last-weeks-build', seededAt: new Date().toISOString(), files }),
  'utf8'
)

console.log(`   ${owned.length} files, no ${NEW_FILE}, stamped as "last-weeks-build"`)

const app = await electron.launch({
  executablePath: APP,
  args: [],
  env: {
    ...process.env,
    HERMES_HOME: home,
    HERMES_DESKTOP_USER_DATA_DIR: userData
    // No HERMES_DESKTOP_BOOT_FAKE here, unlike the other probes: faking the
    // boot skips backend resolution, which is exactly where the source refresh
    // lives. The backend will fail to start against this fabricated install —
    // that is fine and not what is being measured.
  }
})

// The app's own account of this decision goes to rememberLog, which writes to
// an internal buffer and the desktop log file — not to stdout. An earlier
// version of this probe printed "(nothing)" from a stdout listener and read it
// as evidence the code had not run, which was worth an hour of chasing. The
// outcomes below are the evidence.
const page = await app.firstWindow()

await page.waitForTimeout(15000)

const failures = []
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)

  if (!ok) {
    failures.push(label)
  }
}

console.log('\n--- after the new app has opened ---')

check('the new file arrived', fs.existsSync(path.join(installed, NEW_FILE)))
check(
  'the stamp now names this build',
  (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(installed, STAMP), 'utf8')).bundle !== 'last-weeks-build'
    } catch {
      return false
    }
  })()
)
check('the venv was not rebuilt', fs.existsSync(path.join(installed, 'venv', 'bin', 'hermes')))
check(
  "the user's own file is untouched",
  fs.readFileSync(path.join(installed, 'my-own-file.txt'), 'utf8') === 'do not touch'
)

await app.close()

// The backend keeps writing for a moment after the window closes; a cleanup
// that races it fails on a directory that is not empty and buries the result.
await new Promise(resolve => setTimeout(resolve, 1500))

try {
  fs.rmSync(tmp, { force: true, maxRetries: 5, recursive: true, retryDelay: 300 })
} catch {
  // A leftover temp directory is not worth failing a run over.
}

console.log(failures.length ? `\nRESULT: ${failures.length} FAILED` : '\nRESULT: an old install updates itself')
process.exit(failures.length ? 1 : 0)
