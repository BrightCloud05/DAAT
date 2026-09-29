import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { CatStatus, CatSettings as Settings } from '@/lib/cat-types'

import { CatSettings } from './cat-settings'
import { $productLocale } from './strings'

let settings: Settings
let status: CatStatus
const getSettings = vi.fn()
const setSettings = vi.fn()
const start = vi.fn()
const stop = vi.fn()
beforeEach(() => {
  $productLocale.set('en')
  settings = { enabled: true, autoStart: true, quitWithApp: false, showCpu: true, showMemory: true, showStorage: true, showBattery: true, showNetwork: true, showProgress: true, showUsage: false }
  status = { supported: true, available: true, running: false, error: null, runtimeHome: '/test/profiles/work', profile: 'work', mode: 'local', usageSource: '~/.codex/auth.json' }
  getSettings.mockImplementation(async () => ({ ...settings }))
  setSettings.mockImplementation(async patch => { settings = { ...settings, ...patch };

 return { ...settings } })
  start.mockImplementation(async () => { status = { ...status, running: true } })
  stop.mockImplementation(async () => { status = { ...status, running: false } })
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: { cat: { getSettings, setSettings, getStatus: async () => ({ ...status }), start, stop } } })
})
afterEach(() => { cleanup(); vi.resetAllMocks(); Reflect.deleteProperty(window, 'hermesDesktop') })

it('updates display preferences through Electron and reflects the actual helper run state', async () => {
  render(<CatSettings />)
  const usage = await screen.findByRole('checkbox', { name: 'Codex account usage' })
  expect((usage as HTMLInputElement).checked).toBe(false)
  fireEvent.click(usage)
  await waitFor(() => expect((usage as HTMLInputElement).checked).toBe(true))
  expect(setSettings).toHaveBeenCalledWith({ showUsage: true })
  fireEvent.click(screen.getByRole('button', { name: 'Start now' }))
  await screen.findByRole('button', { name: 'Stop now' })
  expect(start).toHaveBeenCalledOnce()
  expect(screen.getByRole('status').textContent).toBe('Running')
  expect(screen.getByText('DAAT profile: work')).toBeTruthy()
})

it('reconciles a persisted preference when a subsequent native action fails', async () => {
  settings.enabled = false
  setSettings.mockImplementation(async patch => { settings = { ...settings, ...patch }; throw new Error('Helper could not start') })
  render(<CatSettings />)
  const enabled = await screen.findByRole('checkbox', { name: 'Enable DAAT Cat' })
  fireEvent.click(enabled)
  await screen.findByRole('alert')
  await waitFor(() => expect((enabled as HTMLInputElement).checked).toBe(true))
  expect(screen.getByRole('alert').textContent).toContain('Helper could not start')
  expect(screen.getByRole('status').textContent).toBe('Stopped')
})
