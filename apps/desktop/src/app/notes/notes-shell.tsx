/**
 * NotesShell — the simple-mode app: a Notion-style document surface instead
 * of the developer pane grid. One sidebar (pages + search), one centered
 * document canvas, and the agent as a summonable slide-over (Cmd-J) rather
 * than a permanent column. Advanced mode keeps the full LayoutTreeRoot grid.
 */

import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { WiredPane } from '@/app/contrib/context'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

import { VaultEditorPane } from '../vault/editor-pane'
import { VaultTreePane } from '../vault/tree-pane'
import { $activeNote } from '../vault/store'

const AGENT_PANEL_KEY = 'biseo.notes.agentOpen.v1'

export function NotesShell() {
  const active = useStore($activeNote)
  const [agentOpen, setAgentOpen] = useState(() => {
    try {
      return window.localStorage.getItem(AGENT_PANEL_KEY) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(AGENT_PANEL_KEY, agentOpen ? '1' : '0')
    } catch {
      // Storage unavailable — panel state just won't persist.
    }
  }, [agentOpen])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
        event.preventDefault()
        setAgentOpen(open => !open)
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      {/* Sidebar: pages + search. Translucent — the Glass material shows. */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-(--stroke-nous) bg-(--ui-bg-sidebar)">
        <VaultTreePane />
      </aside>

      {/* Document canvas — the product. */}
      <main className="relative min-w-0 flex-1 bg-(--ui-bg-editor)">
        <VaultEditorPane />

        {/* Agent summon button — quiet, bottom-right, always reachable. */}
        {!agentOpen && (
          <Button
            className="absolute bottom-5 right-5 z-20 shadow-nous"
            size="icon"
            title="Ask the agent (⌘J)"
            variant="secondary"
            onClick={() => setAgentOpen(true)}
          >
            <Codicon name="sparkle" />
          </Button>
        )}
      </main>

      {/* Agent slide-over: the full chat surface, summoned — not resident. */}
      <div
        className={cn(
          'flex shrink-0 flex-col overflow-hidden border-l border-(--stroke-nous) bg-(--ui-bg-chrome)',
          'transition-[width] duration-200',
          agentOpen ? 'w-[26rem]' : 'w-0 border-l-0'
        )}
      >
        {agentOpen && (
          <>
            <div className="flex h-9 shrink-0 items-center gap-2 border-b border-(--stroke-nous) px-3">
              <Codicon name="sparkle" className="text-(--dt-primary)" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium">
                Agent{active ? ` · ${active.path.split('/').pop()?.replace(/\.(md|markdown)$/i, '')}` : ''}
              </span>
              <Button size="icon-xs" variant="ghost" title="Close (⌘J)" onClick={() => setAgentOpen(false)}>
                <Codicon name="close" />
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              <WiredPane part="chatRoutes" />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
