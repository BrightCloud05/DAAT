#!/usr/bin/env node
/**
 * Install the agent the way a stranger's brand-new Mac installs it.
 *
 * WHY THIS EXISTS
 *
 * The app ships its own Python source (see stage-agent-source.mjs) and seeds it
 * into ~/.daat on first launch, so a fresh machine never clones anything. That
 * path cannot run on the developer's Mac: there is already a working agent and
 * a populated home directory, so `ensureRuntime` returns early and the seeding
 * code is simply never executed. It was written, reviewed, shipped — and had
 * never once run.
 *
 * The first time it did run, it produced a venv that installed perfectly and an
 * agent that died on `No module named 'hermes_constants'`: pyproject declared
 * fourteen root modules and the bundle carried two. Every install stage exited
 * 0. Stage exit codes are not the bar.
 *
 * THE BAR
 *
 * A bare Mac ends up with an agent that actually starts. Nothing less counts,
 * because `hermes serve` is what the desktop app launches — if it cannot start,
 * the buyer has a window that never connects and no way to find out why.
 *
 * WHAT IS SIMULATED
 *
 * HERMES_HOME points at a throwaway directory, so the live ~/.hermes and ~/.daat
 * are untouched. PATH is trimmed to the four directories a factory-fresh Mac
 * actually has — no Homebrew, no ~/.local/bin, no cargo, no nvm.
 *
 * The `path`, `setup` and `gateway` stages are skipped on purpose: they edit
 * shell rc files, ask for an API key, and start a service. Those are the steps
 * a human does at the keyboard, and they are not what this is testing.
 *
 * Usage: node scripts/probe-fresh-mac.mjs   (needs `npm run build` first)
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DESKTOP_ROOT = path.resolve(import.meta.dirname, '..')
const STAGED = path.join(DESKTOP_ROOT, 'dist', 'agent-src')

// The four directories macOS ships with. Everything else is something a
// developer installed and a buyer has not.
const BARE_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'

const STAGES = ['prerequisites', 'repository', 'venv', 'python-deps', 'node-deps', 'config']

if (!fs.existsSync(path.join(STAGED, 'pyproject.toml'))) {
  console.error(`No staged agent source at ${STAGED}. Run \`npm run build\` first.`)
  process.exit(1)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'daat-freshmac-'))
const home = path.join(tmp, 'home')
const checkout = path.join(home, 'hermes-agent')

fs.mkdirSync(home, { recursive: true })
fs.cpSync(STAGED, checkout, { recursive: true })

console.log(`fresh HERMES_HOME: ${home}`)
console.log(`seeded from the app bundle: ${STAGED}`)
console.log(`PATH: ${BARE_PATH}\n`)

const failures = []

const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)

  if (!ok) {
    failures.push(label)
  }
}

const run = (command, args) =>
  spawnSync(command, args, {
    cwd: checkout,
    encoding: 'utf8',
    env: { ...process.env, HERMES_HOME: home, PATH: BARE_PATH },
    maxBuffer: 64 * 1024 * 1024
  })

console.log('--- the install stages, on a Mac with none of the tooling ---')

for (const stage of STAGES) {
  const started = Date.now()
  const result = run('bash', [path.join(checkout, 'scripts', 'install.sh'), '--stage', stage])
  const seconds = Math.round((Date.now() - started) / 1000)
  const tail = (result.stderr || result.stdout || '').trim().split('\n').slice(-2).join(' ')

  check(`stage ${stage}`, result.status === 0, `${seconds}s${result.status === 0 ? '' : ` — ${tail}`}`)

  if (result.status !== 0) {
    console.log('\nRESULT: FAILED — later stages skipped')
    process.exit(1)
  }
}

// The part that matters. A venv that installs cleanly and an agent that starts
// are two different claims, and only the second one is the product.
console.log('\n--- but does the agent actually start? ---')

const hermes = path.join(checkout, 'venv', 'bin', 'hermes')
const python = path.join(checkout, 'venv', 'bin', 'python')

const version = run(hermes, ['--version'])
check('hermes --version', version.status === 0, (version.stderr || '').trim().split('\n').pop())

// `hermes serve` is the exact command electron/main.ts spawns for the backend.
const serve = run(hermes, ['serve', '--help'])
check('hermes serve --help', serve.status === 0, (serve.stderr || '').trim().split('\n').pop())

// Import every root module pyproject declares. A missing one is an ImportError
// at some random later moment rather than at launch, which is worse.
const declared = /^py-modules\s*=\s*\[([^\]]+)\]/m.exec(fs.readFileSync(path.join(checkout, 'pyproject.toml'), 'utf8'))
const modules = declared ? [...declared[1].matchAll(/"([^"]+)"/g)].map(match => match[1]) : []

check('pyproject declares its root modules', modules.length > 0)

const imports = run(python, ['-c', `import ${modules.join(', ')}`])
check(
  `all ${modules.length} declared root modules import`,
  imports.status === 0,
  (imports.stderr || '').trim().split('\n').pop()
)

fs.rmSync(tmp, { recursive: true, force: true })

console.log(
  failures.length
    ? `\nRESULT: ${failures.length} FAILED — a bare Mac does NOT get a working agent`
    : '\nRESULT: a bare Mac ends up with a working agent'
)
process.exit(failures.length ? 1 : 0)
