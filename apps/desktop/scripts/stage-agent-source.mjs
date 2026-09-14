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

import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isMain } from './utils.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(here, '..')
const repoRoot = resolve(desktopRoot, '../..')

/**
 * Files at the repo root that are not Python modules.
 *
 * The root *modules* are read from pyproject — see declaredModules().
 */
const ROOT_FILES = ['pyproject.toml', 'uv.lock', 'LICENSE', 'constraints-termux.txt']

/** Directories that are not Python packages but are needed all the same. */
const EXTRA_DIRS = ['scripts', 'skills', 'prompts', 'personas']

/**
 * Optional skill categories that ship with Daat, merged into skills/.
 *
 * The repo carries 69 skills in skills/ — those already install themselves on
 * first run — and another 111 in optional-skills/ that ship nowhere. Which of
 * those a note-taking app should carry is a judgement about its readers, so it
 * is written down here rather than left to whoever next edits a glob.
 *
 * Included because they serve someone Daat is actually for:
 *   finance             the Accounting persona, plus excel-author/pptx-author,
 *                       which are useful to anyone who has to hand something in
 *   research            search and source-gathering — the front half of taking
 *                       a note about something you read
 *   productivity        flashcards for students, capture tools for everyone
 *   data-science        jupyter-notebook, for the coursework that needs it
 *   software-development, web-development, devops   the Programming persona
 *   communication, email                            the Office Admin and
 *                       Secretary personas
 *
 * Left out, deliberately:
 *   mlops (31 skills)   model registries and training pipelines. No student,
 *                       accountant or secretary will ever call one, and 31 of
 *                       them would crowd the skill index the model reads.
 *   creative (13)       Blender, Unreal, audio generation — a different product
 *   security, blockchain, payments, gaming, migration, mcp, dogfood
 *
 * Size is not the reason for any of this: the whole optional set is 7.8 MB
 * against a 149 MB app. The reason is that the index of available skills is
 * something the model reads on every turn, and a list padded with tools nobody
 * here will use makes it worse at picking the ones they will.
 */
export const OPTIONAL_SKILL_CATEGORIES = [
  'communication',
  'data-science',
  'devops',
  'email',
  'finance',
  'productivity',
  'research',
  'software-development',
  'web-development'
]

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

/**
 * The single-file modules at the repo root, from pyproject's own declaration.
 *
 * These were hard-coded once, and the list drifted: pyproject declares fourteen
 * and the bundle shipped two. The venv installed cleanly and `hermes --version`
 * then died on `No module named 'hermes_constants'` — a stranger's first launch,
 * on a machine with no repo to fall back to. Same failure mode declaredPackages
 * already guards against, one door down.
 */
export function declaredModules(pyprojectToml) {
  const found = /^py-modules\s*=\s*\[([^\]]+)\]/m.exec(pyprojectToml)

  if (!found) {
    throw new Error('[stage-agent-source] could not read [tool.setuptools] py-modules from pyproject.toml')
  }

  return [...new Set([...found[1].matchAll(/"([^"]+)"/g)].map(match => `${match[1]}.py`))]
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

/** Bundle-owned files, relative POSIX, sorted — mirrors ownedFiles(). */
function walkFiles(root) {
  const found = []
  const skip = new Set([...SKIP, '.daat-bundle-id', '.daat-bundle-stamp'])

  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name) || entry.name.endsWith('.pyc')) {
        continue
      }

      const rel = prefix ? `${prefix}/${entry.name}` : entry.name

      if (entry.isDirectory()) {
        walk(join(dir, entry.name), rel)
      } else if (entry.isFile()) {
        found.push(rel)
      }
    }
  }

  walk(root, '')

  return found.sort()
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
  const modules = declaredModules(pyproject)

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

  // Merge the chosen optional categories into skills/, because that is the one
  // directory tools/skills_sync.py seeds from. Nothing else has to change:
  // first run copies them into the user's profile like any bundled skill.
  const skillsDest = join(dest, 'skills')
  const merged = []

  for (const category of OPTIONAL_SKILL_CATEGORIES) {
    const from = join(repoRoot, 'optional-skills', category)

    if (!existsSync(from)) {
      throw new Error(`[stage-agent-source] optional skill category "${category}" is not in the repo`)
    }

    for (const entry of readdirSync(from, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue
      }

      const target = join(skillsDest, category, entry.name)

      // A same-named skill in both trees would be silently replaced here, and
      // the bundled one is the one that was chosen deliberately.
      if (existsSync(target)) {
        console.warn(`[stage-agent-source] skipping optional ${category}/${entry.name}: already bundled`)
        continue
      }

      copyTree(join(from, entry.name), target)
      merged.push(`${category}/${entry.name}`)
    }
  }

  console.log(`[stage-agent-source] merged ${merged.length} optional skills into skills/`)

  for (const file of [...modules, ...ROOT_FILES]) {
    const from = join(repoRoot, file)

    if (!existsSync(from)) {
      // A declared module that is missing breaks `hermes` on first launch, so
      // it fails the build here instead of on the buyer's machine.
      if (modules.includes(file)) {
        throw new Error(`[stage-agent-source] pyproject declares module "${file}" but it is not in the repo`)
      }

      continue
    }

    cpSync(from, join(dest, file))
    copied.push(file)
  }

  // The identity of this build's source, computed once here so a launch can
  // read one small file instead of hashing forty megabytes. See
  // electron/agent-source.ts — this is what tells an installed agent that a
  // newer one is sitting inside the app.
  const bundleId = createHash('sha1')
    .update(
      walkFiles(dest)
        .map(rel => `${rel}:${createHash('sha1').update(readFileSync(join(dest, rel))).digest('hex')}`)
        .join('\n')
    )
    .digest('hex')

  writeFileSync(join(dest, '.daat-bundle-id'), bundleId, 'utf8')
  console.log(`[stage-agent-source] bundle id ${bundleId.slice(0, 12)}`)

  const megabytes = Math.round(sizeOf(dest) / 1024 / 1024)

  console.log(`[stage-agent-source] staged ${copied.length} entries (${megabytes} MB) -> ${dest}`)

  return { dest, copied, megabytes }
}

if (isMain(import.meta.url)) {
  stageAgentSource()
}
