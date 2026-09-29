import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import {
  createCronJob,
  deleteCronJob,
  getCronJobRuns,
  pauseCronJob,
  resumeCronJob,
  setApiRequestProfile,
  triggerCronJob,
  updateCronJob
} from './hermes'

const api = vi.fn().mockResolvedValue({ runs: [] })
beforeEach(() => {
  api.mockClear()
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: { api } })
  setApiRequestProfile('personal')
})
afterEach(() => {
  setApiRequestProfile(null)
  Reflect.deleteProperty(window, 'hermesDesktop')
})

it('targets the owning profile for every automation mutation and run history', async () => {
  const profile = 'work'
  await createCronJob({ prompt: 'brief', schedule: 'every 1h' }, profile)
  await updateCronJob('same-id', { name: 'renamed' }, profile)
  await pauseCronJob('same-id', profile)
  await resumeCronJob('same-id', profile)
  await triggerCronJob('same-id', profile)
  await deleteCronJob('same-id', profile)
  await getCronJobRuns('same-id', 20, profile)

  for (const [request] of api.mock.calls) {
    expect(request.profile).toBe(profile)
    expect(new URL(request.path, 'http://localhost').searchParams.get('profile')).toBe(profile)
  }
})
