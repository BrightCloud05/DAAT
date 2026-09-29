/**
 * Document topbar — Notion's header grammar: breadcrumb on the left,
 * "Edited …" + actions on the right. Sits above the document canvas inside
 * the notes shell.
 */

import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

import { $activeNote, openNote } from '../vault/store'
import { $canvasView } from './view-store'

function editedAgo(mtimeMs: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - mtimeMs) / 60_000))

  if (minutes < 1) return 'Edited just now'
  if (minutes < 60) return `Edited ${minutes}m ago`

  const hours = Math.round(minutes / 60)

  if (hours < 24) return `Edited ${hours}h ago`

  return `Edited ${Math.round(hours / 24)}d ago`
}

export function DocTopbar({ agentOpen, onToggleAgent }: { agentOpen: boolean; onToggleAgent: () => void }) {
  const active = useStore($activeNote)
  const view = useStore($canvasView)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)

    return () => clearInterval(timer)
  }, [])

  // Breadcrumb + edited-time describe the open NOTE; Home and the table
  // carry their own headers, so the topbar goes quiet there.
  const segments = view === 'note' && active ? active.path.replace(/\.(md|markdown)$/i, '').split('/') : []

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 px-3">
      <div className="flex min-w-0 flex-1 items-center gap-0.5 text-[13px]">
        {segments.map((segment, index) => (
          <span key={index} className="flex min-w-0 items-center gap-0.5">
            {index > 0 && <span className="opacity-35">/</span>}
            <span
              className={cn(
                'max-w-[14rem] truncate rounded-md px-1.5 py-0.5',
                index === segments.length - 1
                  ? 'font-medium'
                  : 'cursor-default opacity-60'
              )}
            >
              {segment}
            </span>
          </span>
        ))}
      </div>

      {view === 'note' && active ? (
        <span className="mr-1 shrink-0 text-xs opacity-45">{editedAgo(active.mtimeMs, now)}</span>
      ) : null}

      <button
        className={cn(
          'flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[13px] transition-colors',
          agentOpen
            ? 'bg-(--ui-control-active-background) text-(--dt-primary)'
            : 'hover:bg-(--ui-control-hover-background)'
        )}
        title={agentOpen ? 'Close agent (⌘J)' : 'Ask the agent (⌘J)'}
        onClick={onToggleAgent}
      >
        <Codicon name="sparkle" className={agentOpen ? '' : 'text-(--dt-primary)'} />
        <span>Agent</span>
      </button>
    </div>
  )
}
