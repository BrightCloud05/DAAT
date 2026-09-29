#!/usr/bin/env node
/**
 * Screenshots of the real app, for the site.
 *
 * The landing page drew its screens by hand in CSS. That was honest enough
 * while the product was moving weekly, but "what does it actually look like"
 * is the question a drawing cannot answer — and a mockup that drifts from the
 * build is worse than no picture at all.
 *
 * So these come out of the same Electron app the DMG ships, driven by the same
 * Playwright harness the probes use, against a seeded vault that looks like
 * somebody's actual notes rather than lorem.
 *
 * Usage: node scripts/shoot-site.mjs   (needs `npm run build` first)
 *        Output: scripts/.shots/*.png
 */

import { _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DESKTOP_ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(DESKTOP_ROOT, 'scripts', '.shots')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'daat-shots-'))
const home = path.join(tmp, 'home')
const vault = path.join(tmp, 'vault')
const userData = path.join(tmp, 'userData')

for (const dir of [home, vault, userData, OUT]) {
  fs.mkdirSync(dir, { recursive: true })
}

/** A vault with a week in it, so the screens have something to be about. */
const NOTES = {
  'Courses/선형대수.md':
    '---\ncourse: MATH2061\nsemester: 2026 S2\n---\n\n# 선형대수\n\n' +
    '## 6주차 — 고윳값\n\n' +
    'A에서 람다 I를 뺀 행렬식이 특성방정식을 주고, 그 근이 우리가 찾는 고윳값이다.\n\n' +
    '대각화가 되려면 고유벡터가 n개 있어야 한다. 중근이 있어도 고유공간 차원이\n' +
    '모자라면 대각화되지 않는다.\n\n' +
    '## 과제\n\n- [ ] 과제 2 — 5.3, 5.4 연습문제\n- [x] 과제 1 제출\n',
  'Courses/Statistics.md':
    '---\ncourse: STAT2011\n---\n\n# Statistics\n\n## Week 6 — hypothesis testing\n\n' +
    'The p-value is the probability of seeing data this extreme *if the null were true*.\n' +
    'It is not the probability the null is true — the thing everyone says it is.\n',
  'Daily/2026-08-06.md':
    '---\ndate: 2026-08-06\n---\n\n# 2026-08-06\n\n## 오늘\n\n' +
    '- [ ] 과제 2 마무리\n- [ ] 지훈한테 견적 확인\n- [x] 통계 6주차 읽기\n\n## 메모\n\n' +
    '고윳값 부분이 생각보다 오래 걸림. 대각화 조건을 다시 정리해야 함.\n',
  'Inbox/2026-08-06.md':
    '---\ntype: inbox\ndate: 2026-08-06\n---\n\n# 2026-08-06\n\n' +
    '## 15:32 — 가격 정책\n\n월 29달러로 정했다. 매출보다 사용자 확보가 먼저.\n\n' +
    '## 16:04 — 공급업체 통화\n\n9월 1일까지 견적 받기로. 담당은 지훈.\n\n' +
    '## 17:20 — 대각화 조건\n\n' +
    '고유벡터가 n개 있어야 대각화 가능. 중근이 있으면 고유공간 차원을 따로 확인할 것.\n',
  'Meetings/2026-08-06 1604 공급업체.md':
    '---\ndate: 2026-08-06\nduration: 24:11\nstatus: done\n---\n\n# 공급업체 통화\n\n' +
    '> [!note] Recording\n> `Meetings/2026-08-06 1604 공급업체/audio.webm`\n\n' +
    '## 요약\n\n단가와 납기를 확인했다. 9월 물량은 기존 단가 유지.\n\n' +
    '## 결정\n\n- 9월 1일까지 정식 견적 받기\n\n## 할 일\n\n- [ ] 견적 확인 — 지훈\n',
  'Templates/Lecture.md': '---\ndate: {{date}}\ncourse:\n---\n\n## 요점\n\n## 질문\n\n- [ ]\n'
}

for (const [rel, body] of Object.entries(NOTES)) {
  const target = path.join(vault, rel)

  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, body, 'utf8')
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

// A window the shots can be composed in: wide enough for the three-column
// shell, short enough that a screenshot is readable on a phone.
await page.setViewportSize({ width: 1280, height: 800 })
await page.waitForTimeout(2500)

const shot = async (name, options = {}) => {
  await page.waitForTimeout(options.settle ?? 900)
  await page.screenshot({ path: path.join(OUT, `${name}.png`), ...options.clip })
  console.log(`  ${name}.png`)
}

console.log('--- first run, before anything is set up ---')
await shot('01-onboarding')

console.log('--- past the wizard, into the vault ---')
await page.evaluate(() => {
  localStorage.setItem('hermes-desktop-onboarded-v1', '1')
  localStorage.setItem('hermes-onboarding-skipped-v1', '1')
  localStorage.setItem('daat.onboarded.v1', '1')
  localStorage.setItem('daat.persona.v1', 'student')
})
await page.reload()
await page.waitForTimeout(9000)
await page.addStyleTag({
  content: [
    // Setup overlays: artifacts of HERMES_DESKTOP_BOOT_FAKE, not of the product.
    '[class*="z-setup"], [class*="z-connecting"] { display: none !important; pointer-events: none !important; }',
    // Same for the status bar's "Gateway needs setup" — there is no gateway in
    // this harness. On a machine with a provider connected it is not there, so
    // leaving it in would be showing a broken build rather than the real one.
    'footer, [class*="statusbar"], [class*="status-bar"] { visibility: hidden !important; }',
    // The editor's focus ring follows Playwright's clicks into every shot.
    '.cm-editor.cm-focused { outline: none !important; }'
  ].join('\n')
})

/** Take focus off the editor so its caret and ring stay out of the frame. */
const blur = () => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())

/** Start at the top of the document, wherever the last click left it. */
const toTop = () => page.evaluate(() => document.querySelector('main .overflow-y-auto')?.scrollTo(0, 0))

await page.locator('aside button', { hasText: '선형대수' }).last().click()
await page.waitForTimeout(1400)
await toTop()
await blur()
await shot('02-editor', { settle: 900 })

console.log('--- the inline prompt, over a real selection ---')
// ONE paragraph, not the whole file. Selecting everything reveals the raw
// markdown on every selected line — correct behaviour, wrong screenshot.
await page.evaluate(() => {
  const line = [...document.querySelectorAll('main .cm-line')].find(el => el.textContent?.includes('행렬식'))

  if (!line) {
    return
  }

  const range = document.createRange()

  range.selectNodeContents(line)

  const selection = getSelection()

  selection?.removeAllRanges()
  selection?.addRange(range)
})
await page.waitForTimeout(400)
await page.keyboard.press('ControlOrMeta+i')
await page.waitForTimeout(900)
await page.keyboard.type('기억에 남을 한 줄로 줄여 줘')
await shot('03-inline-ai', { settle: 700 })
await page.keyboard.press('Escape')

console.log('--- what the agent filed on its own ---')
// By path, not by label: three notes are named for the same date, and the
// first run of this picked the Meetings one.
// The Inbox folder starts collapsed, and three notes carry the same date in
// their name — so expand it first, then take rows in tree order (Courses,
// Daily, Inbox, Meetings): Daily's is 0, Inbox's is 1.
await page.locator('aside button').filter({ hasText: /^Inbox$/ }).first().click()
await page.waitForTimeout(900)
await page.locator('aside button').filter({ hasText: '2026-08-06' }).nth(1).click()

await page.waitForTimeout(1400)
await toTop()
await blur()
await shot('04-inbox', { settle: 900 })

console.log('--- the modules, each a lens over the same files ---')
for (const [screen, label] of [
  ['Todo', '05-todo'],
  ['Calendar', '06-calendar'],
  ['Graph', '07-graph']
]) {
  const button = page.locator('aside button', { hasText: screen }).last()

  if (await button.count()) {
    await button.click()
    await page.waitForTimeout(1400)
    await blur()
    await shot(label, { settle: 700 })
  }
}

await app.close()
fs.rmSync(tmp, { force: true, recursive: true })

console.log(`\nWrote ${fs.readdirSync(OUT).length} shots to ${OUT}`)
