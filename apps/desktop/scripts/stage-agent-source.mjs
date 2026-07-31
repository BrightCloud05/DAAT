#!/usr/bin/env node
/**
 * Copy the agent's Python source into the app bundle.
 *
 * WHY
 *
 * A fresh install currently clones the repository and then downloads and builds
 * about 2.4 GB into ~/.daat — of which 1.3 GB is `node_modules` for rebuilding
 * the desktop renderer. The packaged app already contains that renderer. The
 * buyer is downloading, twice, something they then never use, and the local
 * rebuild is a feature a paid product turns off anyway.
 *
 * What the app actually needs from the repo is narrow: it runs
 * `hermes serve` out of a venv (electron/main.ts, resolveBackend). That is the
 * Python source and nothing else.
 *
 * It also removes the requirement that the repository be PUBLIC. The installer
 * clones anonymously, so a private repo would leave a fresh machine with
 * nothing to fetch. Shipping the source means there is nothing to fetch.
 *
 * WHAT IS COPIED
 *
 * The package list is read from pyproject.toml rather than hard-coded here, so
 * a package added upstream is not silently left out of the bundle — the failure
 * mode for that is an ImportError on a stranger's machine, long after the build
 * looked fine.
 *
 * Usage: node scripts/stage-agent-source.mjs   (run from apps/desktop)
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isMain } from './utils.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(here, '..')
const repoRoot = resolve(desktopRoot, '../..')

/** Files at the repo root the agent needs at runtime or on install. */
const ROOT_FILES = [
  'pyproject.toml',
  'uv.lock',
  'LICENSE',
  'cli.py',
  'batch_runner.py',
  'constraints-termux.txt'
]

/** Directories that are not Python packages but are needed all the same. */
const EXTRA_DIRS = ['scripts', 'skills', 'prompts', 'personas']

/** Never ship these into a user's machine. */
const SKIP = new Set(['__pycache__', '.pytest_cache', '.ruff_cache', 'node_modules', '.git', '.venv', 'venv'])

/**
 * The Python packages, taken from pyproject's own declaration.
 *
 * Hard-coding this list is how a package added upstream goes missing from the
 * bundle and surfaces as an ImportError on someone else's machine.
 */
export function declaredPackages(pyprojectToml) {
  const found = /^include\s*=\s*\[([^\]]+)\]/m.exec(pyprojectToml)

  if (!found) {
    throw new Error('[stage-agent-source] could not read [tool.setuptools.packages.find] include from pyproject.toml')
  }

  const names = [...found[1].matchAll(/"([^"]+)"/g)]
    .map(match => match[1])
    // "agent.*" is the same directory as "agent".
    .filter(name => !name.includes('*'))

  return [...new Set(names)]
}

function copyTree(from, to) {
  cpSync(from, to, {
    recursive: true,
    filter: source => {
      const name = source.split('/').pop() ?? ''

      return !SKIP.has(name) && !name.endsWith('.pyc')
    }
  })
}

function sizeOf(dir) {
  let total = 0

  const walk = current => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)

      if (entry.isDirectory()) {
        walk(full)
      } else {
        total += statSync(full).size
      }
    }
  }

  walk(dir)

  return total
}

export function stageAgentSource({ dest = resolve(desktopRoot, 'dist/agent-src') } = {}) {
  const pyproject = readFileSync(join(repoRoot, 'pyproject.toml'), 'utf8')
  const packages = declaredPackages(pyproject)

  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })

  const copied = []

  for (const name of [...packages, ...EXTRA_DIRS]) {
    const from = join(repoRoot, name)

    if (!existsSync(from)) {
      // EXTRA_DIRS are best-effort; a declared package that is missing is a
      // real problem and must not ship quietly.
      if (packages.includes(name)) {
        throw new Error(`[stage-agent-source] pyproject declares package "${name}" but it is not in the repo`)
      }

      continue
    }

    copyTree(from, join(dest, name))
    copied.push(name)
  }

  for (const file of ROOT_FILES) {
    const from = join(repoRoot, file)

    if (existsSync(from)) {
      cpSync(from, join(dest, file))
      copied.push(file)
    }
  }

  const megabytes = Math.round(sizeOf(dest) / 1024 / 1024)

  console.log(`[stage-agent-source] staged ${copied.length} entries (${megabytes} MB) -> ${dest}`)

  return { dest, copied, megabytes }
}

if (isMain(import.meta.url)) {
  stageAgentSource()
}
