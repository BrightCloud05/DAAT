import { _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = '/Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop'
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'daat-pet-'))
const home = path.join(tmp, 'home'), vault = path.join(tmp, 'vault'), ud = path.join(tmp, 'ud')
for (const d of [home, vault, ud]) fs.mkdirSync(d, { recursive: true })
fs.writeFileSync(path.join(vault, 'A.md'), '# A\n', 'utf8')
fs.writeFileSync(path.join(ud, 'vault.json'), JSON.stringify({ root: vault }), 'utf8')

const app = await electron.launch({ args: [ROOT], env: { ...process.env, HERMES_HOME: home, HERMES_DESKTOP_USER_DATA_DIR: ud, HERMES_DESKTOP_BOOT_FAKE: '1' } })
const page = await app.firstWindow()
await page.setViewportSize({ width: 1280, height: 900 })
await page.waitForTimeout(2500)
await page.evaluate(() => { for (const k of ['hermes-desktop-onboarded-v1','hermes-onboarding-skipped-v1','daat.onboarded.v1']) localStorage.setItem(k,'1'); localStorage.setItem('daat.persona.v1','student') })
await page.reload(); await page.waitForTimeout(9000)
await page.addStyleTag({ content: '[class*="z-setup"],[class*="z-connecting"]{display:none!important;pointer-events:none!important}' })

await page.locator('aside button', { hasText: 'Settings' }).last().click()
await page.waitForTimeout(1500)
const appearance = page.locator('button', { hasText: 'Appearance' }).first()
if (await appearance.count()) { await appearance.click(); await page.waitForTimeout(1800) }

const body = await page.evaluate(() => document.body.innerText)
const hit = body.match(/.{0,80}(pet|Pet|펫|고양이).{0,120}/s)
console.log('--- Appearance 안에 펫 관련 텍스트 ---')
console.log(hit ? hit[0].replace(/\n/g, ' | ') : 'NONE FOUND')

// Scroll to the bottom where PetSettings lives.
await page.evaluate(() => document.querySelectorAll('[class*="overflow-y"]').forEach(el => el.scrollTo(0, 99999)))
await page.waitForTimeout(900)
await page.screenshot({ path: '/tmp/pet-settings.png' })
console.log('shot: /tmp/pet-settings.png')
await app.close()
fs.rmSync(tmp, { force: true, recursive: true })
