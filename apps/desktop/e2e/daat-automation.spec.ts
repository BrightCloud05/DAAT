import fs from 'node:fs'
import path from 'node:path'

import { expect, test } from '@playwright/test'

import { buildAppEnv, createSandbox, launchDesktop, writeEnvFile, writeMockProviderConfig } from './fixtures'
import { startMockServer } from './mock-server'

interface AutomationProbeWindow extends Window {
  hermesDesktop: { api<T>(request: { path: string }): Promise<T> }
}

/** Real Electron -> real Hermes backend -> isolated mock inference; no live accounts. */
test('AUTOMATION replaces Money and persists, runs and removes a scheduled job', async () => {
  test.setTimeout(180_000)
  const sandbox = createSandbox('daat-automation')
  const mock = await startMockServer()
  const vault = path.join(sandbox.root, 'vault')
  fs.mkdirSync(vault)
  fs.writeFileSync(path.join(vault, 'Example.md'), '# Example\n')
  fs.writeFileSync(path.join(sandbox.userDataDir, 'vault.json'), JSON.stringify({ root: vault }))
  fs.writeFileSync(path.join(sandbox.userDataDir, 'menubar-cat.json'), JSON.stringify({ enabled: false, autoStart: false, showUsage: false }))
  writeMockProviderConfig(sandbox.hermesHome, mock.url, '  language: ko', undefined, 128_000)
  writeEnvFile(sandbox.hermesHome)
  const { app, page } = await launchDesktop(buildAppEnv(sandbox, {
    HIMALAYA_BIN: path.join(sandbox.root, 'no-mail-account'),
    HERMES_DESKTOP_DEV_SERVER: ''
  }))
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.evaluate(() => {
      localStorage.setItem('daat.onboarded.v1', '1')
      localStorage.setItem('hermes-desktop-onboarded-v1', '1')
      localStorage.setItem('hermes-onboarding-skipped-v1', '1')
    })
    await page.reload()
    const menu = page.locator('aside').getByRole('button', { name: '자동화', exact: true })
    await menu.click({ timeout: 90_000 })
    await expect(page.locator('[data-automation-page]')).toBeVisible()
    await expect(page.locator('aside').getByRole('button', { name: /^(Money|가계부)$/ })).toHaveCount(0)
    await page.getByRole('button', { name: '새 자동화', exact: true }).click({ timeout: 30_000 })
    await page.getByLabel('이름', { exact: false }).fill('자동화 통합 확인')
    await page.getByLabel('할 일', { exact: true }).fill('DAAT_AUTOMATION_SMOKE: Say hello without using tools.')
    await page.getByRole('button', { name: '자동화 만들기', exact: true }).click()
    await expect(page.getByRole('heading', { name: '자동화 통합 확인' })).toBeVisible()
    await page.getByRole('button', { name: '관리', exact: true }).click()
    await page.getByRole('menuitem', { name: '자동화 수정', exact: true }).click()
    await page.getByLabel('이름', { exact: false }).fill('자동화 통합 확인 · 수정')
    await page.getByRole('button', { name: '변경 사항 저장', exact: true }).click()
    await expect(page.getByRole('heading', { name: '자동화 통합 확인 · 수정' })).toBeVisible()
    await page.getByRole('button', { name: '일시정지', exact: true }).click()
    await page.getByRole('button', { name: '재개', exact: true }).click()
    await expect(page.getByText('아직 실행 기록이 없습니다', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '지금 실행', exact: true }).click()
    await expect.poll(() => mock.receivedPrompts.some(prompt => prompt.includes('DAAT_AUTOMATION_SMOKE')), { timeout: 60_000 }).toBe(true)
    await expect(page.getByText('아직 실행 기록이 없습니다', { exact: true })).toHaveCount(0, { timeout: 30_000 })
    await page.screenshot({ path: path.join(sandbox.root, 'automation.png') })
    const jobs = await page.evaluate(() => (window as unknown as AutomationProbeWindow).hermesDesktop.api<Array<{ id: string; last_status: string; last_error: string | null }>>({ path: '/api/cron/jobs?profile=default' }))
    expect(jobs).toHaveLength(1)
    expect(jobs[0].last_status).toBe('ok')
    expect(jobs[0].last_error).toBeNull()
    await expect.poll(() => page.evaluate(async id => {
      const result = await (window as unknown as AutomationProbeWindow).hermesDesktop.api<{ runs: unknown[] }>({ path: `/api/cron/jobs/${id}/runs?profile=default` })
      return result.runs.length
    }, jobs[0].id), { timeout: 30_000 }).toBe(1)
    await page.getByRole('button', { name: '관리', exact: true }).click()
    await page.getByRole('menuitem', { name: '삭제', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '삭제', exact: true }).click()
    await expect(page.getByText('아직 자동화가 없습니다', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => (window as unknown as AutomationProbeWindow).hermesDesktop.api({ path: '/api/cron/jobs?profile=default' }))).toEqual([])
    expect(fs.existsSync(path.join(sandbox.hermesHome, 'cron', 'jobs.json'))).toBe(true)
    await page.locator('aside').getByRole('button', { name: 'CAT 설정', exact: true }).click()
    await expect(page.getByText('DAAT Cat 사용', { exact: true })).toBeVisible()
    await page.screenshot({ path: path.join(sandbox.root, 'cat-settings.png') })
    await page.locator('aside').getByRole('button', { name: '에이전트 도구·스킬', exact: true }).click()
    await expect(page.getByPlaceholder('Search skills...')).toBeVisible()
    expect(errors).toEqual([])
    console.log(`DAAT UI evidence: ${sandbox.root}`)
  } finally {
    await app.close().catch(() => undefined)
    await mock.close()
    // Keep only this isolated run's evidence for review; it contains no credentials beyond the mock key.
  }
})
