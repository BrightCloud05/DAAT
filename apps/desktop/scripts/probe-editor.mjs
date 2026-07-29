#!/usr/bin/env node
/**
 * Headless probe of the real app: launch Electron against a throwaway vault,
 * open a note, type into the editor, and report what actually happens in the
 * DOM. Diagnostic tool — run when the editor misbehaves in ways unit tests
 * can't see (layout, overlays, focus, IPC).
 *
 * Usage: node scripts/probe-editor.mjs   (needs `npm run build` first)
 */

import { _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DESKTOP_ROOT = path.resolve(import.meta.dirname, '..')

// PROBE_HOME / PROBE_VAULT reproduce the user's real state; without them the
// probe runs fully isolated (throwaway home + vault, faked boot).
const realHome = process.env.PROBE_HOME
const realVault = process.env.PROBE_VAULT

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'biseo-probe-'))
const home = realHome || path.join(tmp, 'home')
const vault = realVault || path.join(tmp, 'vault')

fs.mkdirSync(tmp, { recursive: true })

if (!realHome) {
  fs.mkdirSync(home, { recursive: true })
}

if (!realVault) {
  fs.mkdirSync(vault, { recursive: true })
  fs.writeFileSync(path.join(vault, 'Probe.md'), '# Probe\n\nfirst line\n', 'utf8')
}

const userData = path.join(tmp, 'userData')

fs.mkdirSync(userData, { recursive: true })
fs.writeFileSync(path.join(userData, 'vault.json'), JSON.stringify({ root: vault }), 'utf8')

const app = await electron.launch({
  args: [DESKTOP_ROOT],
  env: {
    ...process.env,
    HERMES_HOME: home,
    HERMES_DESKTOP_USER_DATA_DIR: userData,
    ...(realHome ? {} : { HERMES_DESKTOP_BOOT_FAKE: '1' })
  }
})

const page = await app.firstWindow()

page.on('console', message => console.log(`[renderer:${message.type()}]`, message.text()))
page.on('pageerror', error => console.log('[pageerror]', error.message))

// The first-run overlay covers the whole window and eats every click. It is
// not what we're probing, so mark onboarding done and reload into the app.
await page.waitForTimeout(2500)
await page.evaluate(() => {
  localStorage.setItem('hermes-desktop-onboarded-v1', '1')
  localStorage.setItem('hermes-onboarding-skipped-v1', '1')
  // Pin the product language: it otherwise follows the OS, and this machine
  // reports Korean — which is the feature working, but it makes assertions
  // on English copy fail for the wrong reason.
  localStorage.setItem('biseo.locale.v1', 'en')
  // BISEO's own first-run wizard (scripts/probe-onboarding.mjs covers it).
  localStorage.setItem('biseo.onboarded.v1', '1')
})
await page.reload()
await page.waitForTimeout(9000)

const report = await page.evaluate(async () => {
  const out = {}

  out.url = location.href
  out.uiMode = localStorage.getItem('biseo.desktop.uiMode.v1')
  out.hasVaultBridge = Boolean(window.hermesDesktop?.vault)

  try {
    out.vaultInfo = await window.hermesDesktop.vault.info()
    out.notes = (await window.hermesDesktop.vault.list()).map(note => note.path)
  } catch (error) {
    out.vaultError = String(error)
  }

  out.sidebarButtons = [...document.querySelectorAll('aside button')].map(node => node.textContent?.trim()).slice(0, 20)
  out.editorCount = document.querySelectorAll('.cm-editor').length

  // What covers the app? Anything fixed/absolute spanning most of the window
  // and still accepting pointer events is a click thief.
  out.blockers = [...document.querySelectorAll('body *')]
    .filter(node => {
      const style = getComputedStyle(node)
      const rect = node.getBoundingClientRect()

      return (
        (style.position === 'fixed' || style.position === 'absolute') &&
        style.pointerEvents !== 'none' &&
        style.display !== 'none' &&
        rect.width > window.innerWidth * 0.6 &&
        rect.height > window.innerHeight * 0.6
      )
    })
    .map(node => ({
      tag: node.tagName,
      cls: String(node.className).slice(0, 110),
      opacity: getComputedStyle(node).opacity,
      bg: getComputedStyle(node).backgroundColor,
      z: getComputedStyle(node).zIndex
    }))
    .slice(0, 6)

  return out
})

console.log('--- boot report ---')
console.log(JSON.stringify(report, null, 2))

// Click the Probe page in the sidebar, then try to type.
const noteLabel = process.env.PROBE_NOTE || 'Probe'
// Sidebar rows show the note TITLE, not its path.
const rowLabel = noteLabel.split('/').pop().replace(/\.(md|markdown)$/i, '')
const probeRow = page.locator('aside button', { hasText: rowLabel }).first()

if (await probeRow.count()) {
  await probeRow.click()
  await page.waitForTimeout(1500)
} else {
  console.log(`!! no sidebar row matched "${noteLabel}" — nothing was clicked`)
}

const afterOpen = await page.evaluate(() => ({
  editorCount: document.querySelectorAll('.cm-editor').length,
  contentEditable: document.querySelector('.cm-content')?.getAttribute('contenteditable') ?? null,
  editorRect: (() => {
    const node = document.querySelector('.cm-editor')

    if (!node) return null

    const rect = node.getBoundingClientRect()

    return { w: Math.round(rect.width), h: Math.round(rect.height), x: Math.round(rect.x), y: Math.round(rect.y) }
  })(),
  docText: document.querySelector('.cm-content')?.textContent ?? null,
  // What element actually receives a click in the middle of the editor?
  elementAtEditorCenter: (() => {
    const node = document.querySelector('.cm-content')

    if (!node) return null

    const rect = node.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + 20)

    return hit ? `${hit.tagName}.${hit.className}`.slice(0, 120) : null
  })()
}))

console.log('--- after opening the note ---')
console.log(JSON.stringify(afterOpen, null, 2))

// Snapshot before typing, so we can tell "frontmatter preserved" from
// "this note never had any".
const notePathForProbe = path.join(vault, process.env.PROBE_NOTE || 'Probe.md')
const before = fs.existsSync(notePathForProbe) ? fs.readFileSync(notePathForProbe, 'utf8') : ''

const content = page.locator('.cm-content').first()

if (await content.count()) {
  await content.click()
  await page.waitForTimeout(300)
  await page.keyboard.type('TYPED')
  // Autosave is debounced 1s; wait past it so we can check the real file.
  await page.waitForTimeout(3000)

  const afterTyping = await page.evaluate(() => ({
    docText: document.querySelector('.cm-content')?.textContent ?? null,
    activeElement: `${document.activeElement?.tagName}.${document.activeElement?.className}`.slice(0, 120)
  }))

  console.log('--- after typing "TYPED" ---')
  console.log(JSON.stringify(afterTyping, null, 2))
  console.log(afterTyping.docText?.includes('TYPED') ? 'RESULT: TYPING WORKS' : 'RESULT: TYPING BLOCKED')

  // Typing that never reaches disk is the failure that matters most.
  const notePath = path.join(vault, process.env.PROBE_NOTE || 'Probe.md')
  const onDisk = fs.readFileSync(notePath, 'utf8')


  console.log('--- file on disk ---')
  console.log(JSON.stringify(onDisk))
  console.log(onDisk.includes('TYPED') ? 'RESULT: SAVE WORKS' : 'RESULT: SAVE LOST THE EDIT')
  // Only meaningful for a note that HAD frontmatter — otherwise this reported
  // a failure for every plain note.
  if (before.startsWith('---\n')) {
    const head = before.slice(0, before.indexOf('\n---', 4) + 4)

    console.log(onDisk.startsWith(head) ? 'RESULT: FRONTMATTER PRESERVED' : 'RESULT: FRONTMATTER DESTROYED')
  } else {
    console.log('RESULT: (note had no frontmatter — nothing to preserve)')
  }
} else {
  console.log('RESULT: no .cm-content in the DOM — the editor never mounted')
}

await app.close()
