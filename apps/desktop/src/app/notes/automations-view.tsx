import { useStore } from '@nanostores/react'
import { useNavigate } from 'react-router-dom'

import { notifyError } from '@/store/notifications'
import { ensureGatewayProfile } from '@/store/profile'

import { CronView } from '../cron'
import { sessionRoute } from '../routes'

import { setAgentPanelOpen } from './panes-store'
import { $productLocale, productStrings } from './strings'
import { openHomeView } from './view-store'

export function AutomationsView() {
  const s = productStrings(useStore($productLocale))
  const navigate = useNavigate()

  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="px-6 pt-4 text-xs text-muted-foreground">{s.automationsRuntimeHint}</p>
      <div className="min-h-0 flex-1">
        <CronView
          embedded
          onClose={openHomeView}
          onOpenSession={(id, profile) => {
            void ensureGatewayProfile(profile)
              .then(() => {
                setAgentPanelOpen(true)
                navigate(sessionRoute(id))
              })
              .catch(error => notifyError(error, s.dataLoadFailed))
          }}
        />
      </div>
    </div>
  )
}
