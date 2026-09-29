import { useStore } from '@nanostores/react'
import { useQuery } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { getCronJobs } from '@/hermes'
import { $profileScope, ALL_PROFILES } from '@/store/profile'

import { jobTitle } from '../cron/job-state'

import { $productLocale, productStrings } from './strings'
import { openAutomationsView } from './view-store'

export function AutomationCard() {
  const s = productStrings(useStore($productLocale))
  const profile = useStore($profileScope)

  const jobs = useQuery({
    queryKey: ['daat-home-automations', profile],
    queryFn: () => getCronJobs(profile === ALL_PROFILES ? 'all' : profile),
    refetchInterval: 30_000
  })

  const upcoming = (jobs.data ?? [])
    .filter(job => job.enabled && job.next_run_at)
    .sort((a, b) => String(a.next_run_at).localeCompare(String(b.next_run_at)))
    .slice(0, 3)

  return (
    <div className="flex flex-col gap-4 rounded-xs border border-(--stroke-nous) bg-(--dt-card) p-6">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold">{s.automations}</span>
        <Button onClick={openAutomationsView} size="inline" variant="link">
          {s.manageAutomations}
        </Button>
      </div>
      {jobs.isPending ? (
        <Loader />
      ) : jobs.isError ? (
        <div className="text-xs text-destructive" role="alert">
          {s.automationLoadFailed}
          <Button onClick={() => void jobs.refetch()} size="inline" variant="link">
            {s.retryNow}
          </Button>
        </div>
      ) : upcoming.length ? (
        upcoming.map(job => (
          <button
            className="flex flex-col text-left"
            key={`${job.profile ?? ''}:${job.id}`}
            onClick={openAutomationsView}
          >
            <span className="text-[13px]">{jobTitle(job)}</span>
            <span className="text-xs text-muted-foreground">{new Date(job.next_run_at!).toLocaleString()}</span>
          </button>
        ))
      ) : (
        <span className="text-xs text-muted-foreground">{s.automationsHint}</span>
      )}
    </div>
  )
}
