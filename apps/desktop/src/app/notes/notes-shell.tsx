/**
 * NotesShell — the simple-mode app: a Notion-style document surface instead
 * of the developer pane grid. One sidebar (pages + search), one centered
 * document canvas, and the agent as a summonable slide-over (Cmd-J) rather
 * than a permanent column. Advanced mode keeps the full LayoutTreeRoot grid.
 */

import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import { WiredPane } from '@/app/contrib/context'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'
import { submitAgentPrompt } from '@/store/quick-entry'

import { VaultEditorPane } from '../vault/editor-pane'
import { $activeNote, $vaultNotes, createNote, newUntitledPath } from '../vault/store'

import { AgentSessions } from './agent-sessions'
import { CalendarView } from './calendar-view'
import { GraphView } from './graph-view'
import { HomeView } from './home-view'
import { MailView } from './mail-view'
import { MeetingsView } from './meetings-view'
import { MoneyView } from './money-view'
import { OnboardingWizard } from './onboarding-wizard'
import {
  $agentPanelOpen,
  $notesSidebarOpen,
  setAgentPanelOpen,
  toggleAgentPanel
} from './panes-store'
import { $onboarded, ensureDaatPlugins } from './persona-store'
import { $productLocale, productStrings } from './strings'
import { NotesSidebar } from './sidebar'
import { TableView } from './table-view'
import { routeSessionId } from '../routes'
import { openDailyNote } from './templates'
import { TodoView } from './todo-view'
import { DocTopbar } from './topbar'
import { $canvasView, closeTableView } from './view-store'

/**
 * Open the agent in its own window.
 *
 * A session window renders the full shell (see store/ui-mode), which is the
 * same surface Hermes itself shows — sessions, capabilities, artifacts — so
 * the pop-out is a real workspace rather than a wider version of the panel.
 *
 * With no session yet there is nothing to pop out, so this opens a full
 * instance window instead of failing silently on an empty id.
 */
async function popOutAgent(): Promise<void> {
  const sessionId = routeSessionId(window.location.hash.replace(/^#/, ''))

  try {
    if (sessionId) {
      await window.hermesDesktop.openSessionWindow(sessionId)

      return
    }

    await window.hermesDesktop.openWindow()
  } catch {
    // A window that could not open is not worth breaking the panel over.
  }
}

export function NotesShell() {
  const s = productStrings(useStore($productLocale))
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
    // No timers: the prompt is held until the panel registers its handler, so
    // a slow mount delays the send instead of losing it.
    submitAgentPrompt(prompt)
  }

  /*
   * Daat's own plugins are opt-in through `plugins.enabled`, and the seeded
   * config.yaml comes verbatim from upstream, which has no `plugins:` block.
   * applyPersona turns them on — but only for someone who went through the
   * wizard, and Escape dismisses it. Anyone who skipped it had an agent that
   * could not read or write their vault.
   *
   * Retried rather than fired once: on a first run the Python backend is often
   * still starting, and this is the one thing that must not be lost to that.
   */
  useEffect(() => {
    let cancelled = false

    const attempt = async (remaining: number): Promise<void> => {
      if (cancelled) {
        return
      }

      try {
        await ensureDaatPlugins()
      } catch {
        if (remaining > 0) {
          setTimeout(() => void attempt(remaining - 1), 5_000)
        }
      }
    }

    void attempt(5)

    return () => {
      cancelled = true
    }
  }, [])

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

        // Same rule as the sidebar's New page: making a page is opening a
        // page, and ⌘N from Graph or Todo used to leave the user staring at
        // the screen they were already on.
        closeTableView()
        void createNote(newUntitledPath($vaultNotes.get()))
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
              <Codicon className="text-(--dt-primary)" name="sparkle" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium">
                Agent{active ? ` · ${active.path.split('/').pop()?.replace(/\.(md|markdown)$/i, '')}` : ''}
              </span>
              <AgentSessions />
              {/* Pop the conversation out into its own window.
                  Carries the CURRENT session across rather than opening an
                  empty one: the panel usually holds a thread about the note in
                  front of you, and losing it on the way out is the whole
                  reason people distrust a pop-out button. */}
              <Button
                onClick={() => void popOutAgent()}
                size="icon-xs"
                title={s.popOutAgent}
                variant="ghost"
              >
                <Codicon name="link-external" />
              </Button>
              <Button onClick={() => setAgentOpen(false)} size="icon-xs" title="Close (⌘J)" variant="ghost">
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
