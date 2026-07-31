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

import {
  $agentPanelOpen,
  $notesSidebarOpen,
  setAgentPanelOpen,
  toggleAgentPanel
} from './panes-store'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

import { VaultEditorPane } from '../vault/editor-pane'
import { $activeNote, $vaultNotes, createNote } from '../vault/store'
import { CalendarView } from './calendar-view'
import { MeetingsView } from './meetings-view'
import { GraphView } from './graph-view'
import { HomeView } from './home-view'
import { OnboardingWizard } from './onboarding-wizard'
import { $onboarded } from './persona-store'
import { NotesSidebar } from './sidebar'
import { TableView } from './table-view'
import { TodoView } from './todo-view'
import { MailView } from './mail-view'
import { MoneyView } from './money-view'
import { openDailyNote } from './templates'
import { DocTopbar } from './topbar'
import { $canvasView } from './view-store'

export function NotesShell() {
  const active = useStore($activeNote)
  const canvasView = useStore($canvasView)
  const onboarded = useStore($onboarded)
  // Both panes live in a store, not local state: the window titlebar toggles
  // them, and before that it was wired to the upstream chat shell's panes —
  // which do not exist here, so every titlebar button was a no-op.
  const agentOpen = useStore($agentPanelOpen)
  const sidebarOpen = useStore($notesSidebarOpen)
  const setAgentOpen = setAgentPanelOpen

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
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
        event.preventDefault()
        toggleAgentPanel()
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
      {/* First run: who are you, where do the notes go. Escape dismisses it. */}
      {!onboarded && <OnboardingWizard />}

      {/* Sidebar: pages + search. Translucent — the Glass material shows. */}
      {sidebarOpen ? (
        <aside className="flex w-60 shrink-0 flex-col border-r border-(--stroke-nous) bg-(--ui-bg-sidebar)">
        <NotesSidebar />
        </aside>
      ) : null}

      {/* Document canvas — the product. */}
      <main className="relative flex min-w-0 flex-1 flex-col bg-(--ui-bg-editor)">
        <DocTopbar agentOpen={agentOpen} onToggleAgent={() => toggleAgentPanel()} />
        <div className="min-h-0 flex-1">
          {canvasView === 'graph' ? (
            <GraphView />
          ) : canvasView === 'home' ? (
            <HomeView />
          ) : canvasView === 'table' ? (
            <TableView />
          ) : canvasView === 'todo' ? (
            <TodoView />
          ) : canvasView === 'mail' ? (
            <MailView onAskAgent={askAgent} />
          ) : canvasView === 'money' ? (
            <MoneyView onAskAgent={askAgent} />
          ) : canvasView === 'calendar' ? (
            <CalendarView />
          ) : canvasView === 'meetings' ? (
            <MeetingsView onAskAgent={askAgent} />
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
