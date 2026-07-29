#!/usr/bin/env node
/**
 * Build THIRD_PARTY_NOTICES.txt from the dependencies that actually ship.
 *
 * Most of BISEO's licences (MIT, ISC, BSD, Apache-2.0, CC-BY-4.0) require the
 * notice to travel with binary copies — including our own base, Hermes Agent.
 * The file is listed in package.json `build.files`, so it lands inside the
 * .app rather than only in the repo.
 *
 * Runs from `prebuild`. Walks production dependencies only: devDependencies
 * are build tooling and are not distributed.
 */

import fs from 'node:fs'
import path from 'node:path'

const DESKTOP_ROOT = path.resolve(import.meta.dirname, '..')
const REPO_ROOT = path.resolve(DESKTOP_ROOT, '..', '..')
const OUT = path.join(DESKTOP_ROOT, 'THIRD_PARTY_NOTICES.txt')

/** Licences that oblige us to reproduce their text or attribution. */
const LICENSE_FILE_NAMES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'license', 'License']

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function licenseTextFor(dir) {
  for (const name of LICENSE_FILE_NAMES) {
    const candidate = path.join(dir, name)

    if (fs.existsSync(candidate)) {
      try {
        return fs.readFileSync(candidate, 'utf8').trim()
      } catch {
        return null
      }
    }
  }

  return null
}

// npm hoists most packages to the workspace root, so a package named in
// apps/desktop/package.json usually lives in the repo-root node_modules.
const MODULE_ROOTS = [path.join(DESKTOP_ROOT, 'node_modules'), path.join(REPO_ROOT, 'node_modules')]

function resolvePackageDir(name) {
  for (const root of MODULE_ROOTS) {
    const dir = path.join(root, ...name.split('/'))

    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir
    }
  }

  return null
}

/** Every transitive production dependency, resolved through node_modules. */
function collectProductionDeps() {
  const rootPkg = readJson(path.join(DESKTOP_ROOT, 'package.json'))
  const seen = new Map()
  const queue = Object.keys(rootPkg?.dependencies ?? {})

  while (queue.length) {
    const name = queue.shift()

    if (seen.has(name)) {
      continue
    }

    const dir = resolvePackageDir(name)
    const pkg = dir ? readJson(path.join(dir, 'package.json')) : null

    if (!pkg) {
      // Hoisted elsewhere or optional-and-absent; record it so the gap is
      // visible rather than silently dropped.
      seen.set(name, { name, version: 'unresolved', license: 'UNKNOWN', text: null })
      continue
    }

    seen.set(name, {
      name,
      version: pkg.version ?? '',
      license: typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? 'UNKNOWN'),
      text: licenseTextFor(dir)
    })

    queue.push(...Object.keys(pkg.dependencies ?? {}))
  }

  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}

const deps = collectProductionDeps()
const upstreamLicense = licenseTextFor(REPO_ROOT)

// electron-builder resolves `build.files` relative to apps/desktop, and the
// MIT licence lives at the repo root — so without this copy the shipped .app
// contained no licence at all, which is the one thing MIT actually requires.
if (upstreamLicense) {
  fs.writeFileSync(path.join(DESKTOP_ROOT, 'LICENSE'), `${upstreamLicense}\n`, 'utf8')
}

const header = `BISEO — Third-party notices
${'='.repeat(72)}

This product includes software developed by third parties. Their licences and
copyright notices are reproduced below.

Generated from the production dependency tree at build time.
`

const upstream = `
${'-'.repeat(72)}
Hermes Agent — the base this application is built on
${'-'.repeat(72)}

BISEO is a fork of Hermes Agent (https://github.com/NousResearch/hermes-agent)
by Nous Research, used under the MIT licence reproduced here.

${upstreamLicense ?? '(LICENSE file not found at the repository root)'}
`

const summary = `
${'-'.repeat(72)}
Bundled packages (${deps.length})
${'-'.repeat(72)}

${deps.map(dep => `${dep.name}@${dep.version} — ${dep.license}`).join('\n')}
`

const bodies = deps
  .filter(dep => dep.text)
  .map(dep => `\n${'-'.repeat(72)}\n${dep.name}@${dep.version} (${dep.license})\n${'-'.repeat(72)}\n\n${dep.text}\n`)
  .join('')

fs.writeFileSync(OUT, `${header}${upstream}${summary}${bodies}`, 'utf8')

const unknown = deps.filter(dep => dep.license === 'UNKNOWN')

console.log(`[third-party-notices] ${deps.length} packages -> ${path.relative(DESKTOP_ROOT, OUT)}`)

if (unknown.length) {
  console.warn(
    `[third-party-notices] ${unknown.length} package(s) declare no licence: ${unknown.map(d => d.name).join(', ')}`
  )
}
