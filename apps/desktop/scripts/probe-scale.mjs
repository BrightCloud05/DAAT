// How does the shell behave at 10k notes? Measures rather than assumes.
import { _electron as electron } from '@playwright/test'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'

const ROOT = '/Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop'
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'daat-perf-'))
const home = path.join(tmp, 'home'), vault = path.join(tmp, 'vault'), userData = path.join(tmp, 'userData')
for (const d of [home, vault, userData]) fs.mkdirSync(d, { recursive: true })

const N = 10000
for (let i = 0; i < N; i++) {
  const dir = path.join(vault, `Folder ${String(i % 40).padStart(2, '0')}`)
  fs.mkdirSync(dir, { recursive: true })
  const link = i > 0 ? `\n\nSee [[Note ${i - 1}]] and [[Note ${(i * 7) % N}]].\n` : '\n'
  fs.writeFileSync(path.join(dir, `Note ${i}.md`), `---\ntype: note\ntags: [t${i % 12}]\n---\n\n# Note ${i}\n\nbody ${i}${link}`, 'utf8')
}
fs.writeFileSync(path.join(userData, 'vault.json'), JSON.stringify({ root: vault }), 'utf8')
console.log(`seeded ${N} notes`)

const app = await electron.launch({ args: [ROOT], env: { ...process.env, HERMES_HOME: home, HERMES_DESKTOP_USER_DATA_DIR: userData, HERMES_DESKTOP_BOOT_FAKE: '1' } })
const page = await app.firstWindow()
await page.waitForTimeout(2500)
await page.evaluate(() => { localStorage.setItem('hermes-desktop-onboarded-v1','1'); localStorage.setItem('hermes-onboarding-skipped-v1','1'); localStorage.setItem('daat.onboarded.v1','1'); localStorage.setItem('daat.persona.v1','student') })
const t0 = Date.now(); await page.reload(); await page.waitForTimeout(20000)
await page.addStyleTag({ content: '[class*="z-setup"],[class*="z-connecting"]{display:none!important}' })
console.log(`boot+index wait: ${Date.now() - t0}ms`)

const counts = await page.evaluate(() => ({
  sidebarRows: document.querySelectorAll('aside button').length,
  domNodes: document.querySelectorAll('*').length
}))
console.log('sidebar buttons rendered:', counts.sidebarRows, '| total DOM nodes:', counts.domNodes)

// Scroll the rail and see if it keeps up.
const rail = page.locator('aside div.overflow-y-auto').first()
const s0 = Date.now()
for (let i = 0; i < 12; i++) await rail.evaluate(el => { el.scrollTop += 1200 })
console.log(`12 scroll steps: ${Date.now() - s0}ms`)

// Search typing latency.
const box = page.locator('aside input').first()
const q0 = Date.now(); await box.fill('Note 4242'); await page.waitForTimeout(1500)
console.log(`search round-trip: ${Date.now() - q0}ms`)

// Open the Notes table over 10k rows.
const n0 = Date.now()
await page.locator('aside button', { hasText: 'Notes' }).first().click()
await page.waitForTimeout(3000)
const table = await page.evaluate(() => ({ rows: document.querySelectorAll('main tr, main [role="row"]').length, nodes: document.querySelectorAll('main *').length }))
console.log(`table open: ${Date.now() - n0}ms | rows: ${table.rows} | canvas nodes: ${table.nodes}`)

// The graph is the one screen that holds the entire library at once.
const g0 = Date.now()
await page.locator('aside button', { hasText: 'Graph' }).last().click()
await page.waitForTimeout(6000)
const g = await page.evaluate(() => {
  const el = document.querySelector('main canvas')
  const text = document.querySelector('main')?.textContent ?? ''
  return { text: text.slice(0, 70), w: el?.width ?? 0, h: el?.height ?? 0 }
})
console.log(`graph open+settle: ${Date.now() - g0}ms | ${g.text} | canvas ${g.w}x${g.h}`)

// Frames actually delivered over one second while the simulation runs.
const fps = await page.evaluate(() => new Promise(resolve => {
  let n = 0
  const t0 = performance.now()
  const step = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(step); else resolve(n) }
  requestAnimationFrame(step)
}))
console.log(`frames in 1s while simulating: ${fps}`)

await app.close()
