import { atom } from 'nanostores'
import { beforeEach, expect, it, vi } from 'vitest'

import { getCronJobs } from '@/hermes'
import type { CronJob } from '@/types/hermes'

import { $cronJobs, refreshCronJobsForScope, setCronJobs, updateCronJobs } from './cron'
import { $profileScope } from './profile'

vi.mock('@/hermes', () => ({ getCronJobs: vi.fn() }))
vi.mock('./profile', () => ({ $profileScope: atom('work'), ALL_PROFILES: 'all' }))
const scope = $profileScope as ReturnType<typeof atom<string>>
const job = { id: 'one', profile: 'work', name: 'current' } as CronJob
beforeEach(() => {
  scope.set('work')
  setCronJobs([])
  vi.clearAllMocks()
})

it('a delayed refresh cannot undo a successful edit', async () => {
  let resolve!: (jobs: CronJob[]) => void
  vi.mocked(getCronJobs).mockReturnValue(
    new Promise(done => {
      resolve = done
    })
  )
  const pending = refreshCronJobsForScope('work')
  updateCronJobs(() => [job])
  resolve([{ ...job, name: 'old' }])
  await pending
  expect($cronJobs.get()).toEqual([job])
})

it('an old profile response cannot replace the newly selected profile', async () => {
  let resolve!: (jobs: CronJob[]) => void
  vi.mocked(getCronJobs).mockReturnValue(
    new Promise(done => {
      resolve = done
    })
  )
  const pending = refreshCronJobsForScope('work')
  scope.set('personal')
  resolve([job])
  await pending
  expect($cronJobs.get()).toEqual([])
})
