import { atom } from 'nanostores'

import { getCronJobs } from '@/hermes'
import { $profileScope, ALL_PROFILES } from '@/store/profile'
import type { CronJob } from '@/types/hermes'

// Cron *jobs* (not run sessions) power the sidebar "Cron jobs" section. Listing
// the job — schedule, state, live next-run countdown — makes the job the
// first-class entity; its runs (sessions) resolve under it in the cron detail.
export const $cronJobs = atom<CronJob[]>([])
let refreshGeneration = 0

export const setCronJobs = (jobs: CronJob[]) => {
  refreshGeneration += 1
  $cronJobs.set(jobs)
}

/** Discard responses from an old profile, an earlier fetch, or before a mutation. */
export async function refreshCronJobsForScope(scope: string): Promise<void> {
  const generation = ++refreshGeneration
  const jobs = await getCronJobs(scope === ALL_PROFILES ? 'all' : scope)

  if (generation === refreshGeneration && scope === $profileScope.get()) {
    $cronJobs.set(jobs)
  }
}

// In-place edit so the cron overlay's mutations (create/edit/delete/pause/…)
// land in the same atom the sidebar renders — no stale list until the next poll.
export const updateCronJobs = (fn: (jobs: CronJob[]) => CronJob[]) => setCronJobs(fn($cronJobs.get()))

// One-shot focus target: clicking "Manage" on a job sets this, then opens the
// cron overlay, which reads it once to select + scroll to that job. Cleared
// after consumption so re-opening cron normally doesn't re-focus a stale job.
export const $cronFocusJobId = atom<null | string>(null)
export const setCronFocusJobId = (id: null | string) => $cronFocusJobId.set(id)
