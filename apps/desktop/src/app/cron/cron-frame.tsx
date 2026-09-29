import type { ReactNode } from 'react'

import { Panel } from '../overlays/panel'

interface CronFrameProps {
  children: ReactNode
  embedded: boolean
  onClose: () => void
  closeLabel: string
}

/** The same job editor is a page in Daat and an overlay in the agent workspace. */
export function CronFrame({ children, embedded, onClose, closeLabel }: CronFrameProps) {
  return embedded ? (
    <section className="flex h-full min-h-0 flex-col px-6 py-5" data-automation-page="">
      {children}
    </section>
  ) : (
    <Panel closeLabel={closeLabel} onClose={onClose}>
      {children}
    </Panel>
  )
}
