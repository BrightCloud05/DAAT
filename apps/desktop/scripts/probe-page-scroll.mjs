#!/usr/bin/env node
/**
 * One scroll for the whole page.
 *
 * The title, the properties table and the backlinks row used to be fixed flex
 * items sitting above a CodeMirror that scrolled inside itself. On a note with
 * eight properties that header held about a third of the window permanently:
 * you could scroll for an hour and never get it back, and the body worked in
 * what was left.
 *
 * Notion — and any document — scrolls as one thing. So the check is not "does
 * it scroll" but "does the header LEAVE": the title's position after scrolling
 * has to be above the top of the pane, and the editor has to gain the space.
 *
 * Also guards the two ways this can regress into looking fine while being
 * wrong: CodeMirror re-acquiring its own scrollbar (the pane scrolls, the body
 * doesn't), and the undo bar scrolling off with the document when it is meant
 * to stay where the eye is.
 *
 * Usage: node scripts/probe-page-scroll.mjs   (needs `npm run build` first)
 */

import { _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DESKTOP_ROOT = path.resolve(import.meta.dirname, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'daat-scroll-'))
const home = path.join(tmp, 'home')
const vault = path.join(tmp, 'vault')
const userData = path.join(tmp, 'userData')

for (const dir of [home, vault, userData]) {
  fs.mkdirSync(dir, { recursive: true })
}

// A note shaped like the one that prompted this: a heavy property list and
// enough body to scroll.
const NOTE = [
  '---',
  'title: DAAT Student Agentic Study Prompt Guide',
  'product: DAAT Student Edition',
  'owner: ALLFJ',
  'audience: university students',
  'version: 0.1',
  'status: DRAFT',
  'updated: "2026-08-03"',
  'language: ko',
  '---',
  '',
  '# Heavy Header Note',
  '',
  ...Array.from({ length: 120 }, (_, i) => `Paragraph ${i + 1}: body text that has to earn its room on screen.\n`)
].join('\n')

const LINES = 20000

fs.writeFileSync(path.join(vault, 'Heavy.md'), NOTE, 'utf8')
fs.writeFileSync(
  path.join(vault, 'Long.md'),
  `# Long\n\n${Array.from({ length: LINES }, (_, i) => `Line ${i + 1} of a very long note.`).join('\n\n')}`,
  'utf8'
)
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

await page.locator('aside button', { hasText: 'Heavy' }).last().click()
await page.waitForTimeout(2500)

/** Where the title sits, and who is actually scrolling. */
const measure = () =>
  page.evaluate(() => {
    const title = [...document.querySelectorAll('main h1')].find(h => h.textContent?.includes('Heavy'))
    const scroller = document.querySelector('main .cm-scroller')
    const content = document.querySelector('main .cm-content')

    // The scrolling ancestor of the editor: walk up until something overflows.
    let node = content?.parentElement ?? null
    let owner = null

    while (node && node !== document.body) {
      const style = getComputedStyle(node)

      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 4) {
        owner = { tag: node.tagName.toLowerCase(), cls: node.className.slice(0, 40), scrollTop: node.scrollTop }
        break
      }

      node = node.parentElement
    }

    return {
      titleTop: title ? Math.round(title.getBoundingClientRect().top) : null,
      contentTop: content ? Math.round(content.getBoundingClientRect().top) : null,
      // A CodeMirror that scrolls itself again is the regression to catch.
      cmScrollsItself: scroller ? scroller.scrollHeight > scroller.clientHeight + 4 : false,
      owner
    }
  })

const before = await measure()

console.log(`   title at y=${before.titleTop}, body starts at y=${before.contentTop}`)
console.log(`   scrolling element: ${before.owner ? `${before.owner.tag}.${before.owner.cls}` : 'NONE FOUND'}`)

check('the page has a scrolling container', Boolean(before.owner))
check('CodeMirror is not scrolling inside itself', !before.cmScrollsItself)
check('the title is on screen to begin with', (before.titleTop ?? -1) > 0, `y=${before.titleTop}`)

// Scroll the pane, not the editor.
await page.locator('main').first().hover()
await page.mouse.wheel(0, 900)
await page.waitForTimeout(1200)

const after = await measure()

console.log(`\n   after scrolling 900px: title y=${after.titleTop}, body y=${after.contentTop}`)

check(
  'the title scrolled away with the content',
  after.titleTop !== null && before.titleTop !== null && after.titleTop < before.titleTop - 200,
  `moved ${before.titleTop - after.titleTop}px`
)
check(
  'the body moved up by the same scroll',
  after.contentTop !== null && before.contentTop !== null && after.contentTop < before.contentTop - 200,
  `moved ${before.contentTop - after.contentTop}px`
)

// The undo bar must stay put; it is only useful near the eye.
const undoPinned = await page.evaluate(() => {
  const pane = document.querySelector('main')
  const scroller = [...(pane?.querySelectorAll('div') ?? [])].find(
    node => /(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 4
  )

  // The bar only renders after a rewrite, so this checks its container instead:
  // it must not be a descendant of the scrolling element.
  return scroller ? !scroller.querySelector('[class*="bottom-4"]') : false
})

check('the undo bar is outside the scrolling document', undoPinned)

/*
 * The expensive way this change could have gone wrong.
 *
 * CodeMirror only renders the lines near the viewport, and it works out where
 * that viewport is by finding its scrolling ancestor. Handing the scroll to the
 * pane means it has to find the pane. If it ever fails to, it falls back to
 * rendering the whole document: a long note would put tens of thousands of DOM
 * nodes on the page and typing would crawl — while every check above still
 * passed, because the page would scroll perfectly.
 */
console.log('\n--- and a long note still renders only what is on screen ---')

await page.locator('aside button', { hasText: 'Long' }).last().click()
await page.waitForTimeout(3000)

const long = await page.evaluate(() => ({
  rendered: document.querySelectorAll('.cm-content .cm-line').length,
  height: Math.round(document.querySelector('.cm-content')?.getBoundingClientRect().height ?? 0)
}))

console.log(`   ${LINES * 2} lines in the file, ${long.rendered} in the DOM, box ${long.height}px tall`)

check('only a screenful is in the DOM', long.rendered > 0 && long.rendered < 400, `${long.rendered} .cm-line elements`)
check('but the full document height is known', long.height > 100_000, `${long.height}px`)

await app.close()
fs.rmSync(tmp, { recursive: true, force: true })

console.log(failures.length ? `\nRESULT: ${failures.length} FAILED` : '\nRESULT: ALL CHECKS PASSED')
process.exit(failures.length ? 1 : 0)
