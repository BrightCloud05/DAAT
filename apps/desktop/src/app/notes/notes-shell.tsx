/**
 * NotesShell — the simple-mode app: a Notion-style document surface instead
 * of the developer pane grid. One sidebar (pages + search), one centered
 * document canvas, and the agent as a summonable slide-over (Cmd-J) rather
 * than a permanent column. Advanced mode keeps the full LayoutTreeRoot grid.
 */

import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { WiredPane } from '@/app/contrib/context'
import { submitAgentPrompt } from '@/store/quick-entry'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

import { VaultEditorPane } from '../vault/editor-pane'
import { $activeNote, $vaultNotes, createNote } from '../vault/store'
import { HomeView } from './home-view'
import { NotesSidebar } from './sidebar'
import { TableView } from './table-view'
import { TodoView } from './todo-view'
import { MailView } from './mail-view'
import { MoneyView } from './money-view'
import { openDailyNote } from './templates'
import { DocTopbar } from './topbar'
import { $canvasView } from './view-store'

const AGENT_PANEL_KEY = 'biseo.notes.agentOpen.v1'

export function NotesShell() {
  const active = useStore($activeNote)
  const canvasView = useStore($canvasView)
  const [agentOpen, setAgentOpen] = useState(() => {
    try {
      return window.localStorage.getItem(AGENT_PANEL_KEY) === '1'
    } catch {
      return false
    }
  })

  // Module screens hand work to the agent through the app's one submit
  // pipeline, opening the panel so the user sees it happen.
  const askAgent = (prompt: string) => {
    setAgentOpen(true)
    // Let the panel mount before the prompt lands in it.
    setTimeout(() => {
      if (!submitAgentPrompt(prompt)) {
        setTimeout(() => submitAgentPrompt(prompt), 400)
      }
    }, 120)
  }

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

      // ⌘D — today's daily note.
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        void openDailyNote()
      }

      // ⌘N — Notion's New page, from anywhere in the shell.
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault()

        const existing = new Set($vaultNotes.get().map(note => note.path))
        let name = 'Untitled.md'

        for (let i = 2; existing.has(name); i++) {
          name = `Untitled ${i}.md`
        }

        void createNote(name)
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      {/* Sidebar: pages + search. Translucent — the Glass material shows. */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-(--stroke-nous) bg-(--ui-bg-sidebar)">
        <NotesSidebar />
      </aside>

      {/* Document canvas — the product. */}
      <main className="relative flex min-w-0 flex-1 flex-col bg-(--ui-bg-editor)">
        <DocTopbar agentOpen={agentOpen} onToggleAgent={() => setAgentOpen(open => !open)} />
        <div className="min-h-0 flex-1">
          {canvasView === 'home' ? (
            <HomeView />
          ) : canvasView === 'table' ? (
            <TableView />
          ) : canvasView === 'todo' ? (
            <TodoView />
          ) : canvasView === 'mail' ? (
            <MailView onAskAgent={askAgent} />
          ) : canvasView === 'money' ? (
            <MoneyView onAskAgent={askAgent} />
          ) : (
            <VaultEditorPane />
          )}
        </div>
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
