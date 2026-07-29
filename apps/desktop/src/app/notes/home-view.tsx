/**
 * Home dashboard — implementation of "BISEO Home.dc.html" (design 1a).
 * Real data where the product has it today (briefing numbers, todos with
 * working checkboxes, recent notes); modules that aren't wired yet (Mail,
 * Money, Calendar) render the designed card with an honest "coming soon"
 * state instead of fake numbers.
 */

import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { activeGateway } from '@/store/gateway'

import { $vaultInfo, $vaultNotes, openNote } from '../vault/store'
import { openDailyNote, todayStamp } from './templates'
import { closeTableView } from './view-store'

interface Todo {
  path: string
  line: number
  text: string
  done: boolean
}

const CARD =
  'rounded-xl border border-(--stroke-nous) bg-(--dt-card) p-[18px] flex flex-col gap-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_10px_24px_-18px_rgba(0,0,0,0.22)]'
const CARD_TITLE = 'text-[13px] font-semibold'
const MUTED = 'text-xs opacity-50'

function Sparkle({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="var(--dt-primary)">
      <path d="M8 0.8 9.5 6.5 15.2 8 9.5 9.5 8 15.2 6.5 9.5 0.8 8 6.5 6.5Z" />
    </svg>
  )
}

function editedAgo(mtimeMs: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - mtimeMs) / 60_000))

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`

  const hours = Math.round(minutes / 60)

  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`
}

export function HomeView() {
  const notes = useStore($vaultNotes)
  const info = useStore($vaultInfo)
  const [todos, setTodos] = useState<Todo[]>([])
  const [aiConnected, setAiConnected] = useState(false)

  useEffect(() => {
    let cancelled = false

    void window.hermesDesktop.vault
      .todos(60)
      .then(result => {
        if (!cancelled) {
          setTodos(result)
        }
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [notes])

  useEffect(() => {
    const check = () => setAiConnected(activeGateway()?.connectionState === 'open')

    check()

    const timer = setInterval(check, 5_000)

    return () => clearInterval(timer)
  }, [])

  const open = todos.filter(todo => !todo.done)
  const recent = [...notes].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 3)
  const hasDaily = notes.some(note => note.path === `Daily/${todayStamp()}.md`)
  const dateLabel = new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })

  const openNoteFromHome = (path: string) => {
    closeTableView()
    void openNote(path)
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      {/* Header row: Home · date · AI pill (design: 52px topbar content). */}
      <div className="flex shrink-0 items-center gap-3.5 px-6 pt-4 pb-2">
        <span className="text-[13px] font-semibold">Home</span>
        <span className="text-[13px] opacity-50">{dateLabel}</span>
        <span className="ml-auto flex h-[26px] items-center gap-1.5 rounded-lg border border-(--stroke-nous) bg-(--dt-card) px-2.5 text-xs">
          <span
            className="size-1.5 rounded-full"
            style={{ backgroundColor: aiConnected ? '#28C840' : 'rgba(120,120,128,0.4)' }}
          />
          {aiConnected ? 'AI connected' : 'AI connecting…'}
        </span>
      </div>

      <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-5 px-6 pb-10 pt-3">
        {/* Morning briefing hero — conic-gradient border, real numbers. */}
        <div
          className="rounded-[13px] p-px"
          style={{
            background:
              'conic-gradient(from 210deg at 30% 20%, rgba(0,122,255,0.55), rgba(90,200,250,0.42), rgba(191,90,242,0.40), rgba(255,159,10,0.26), rgba(0,122,255,0.55))',
            boxShadow: '0 18px 40px -22px rgba(0,60,140,0.35)',
            animation: 'biseo-lift 200ms ease-out both'
          }}
        >
          <div className="flex flex-col gap-4 rounded-xl bg-(--dt-card) px-[26px] py-6">
            <div className="flex items-center gap-2">
              <Sparkle />
              <span className="text-xs font-semibold tracking-wide text-(--dt-primary)">Briefing</span>
              <span className={MUTED}>{info?.name ?? 'vault'}</span>
            </div>
            <p className="m-0 max-w-[46rem] text-xl leading-normal tracking-tight">
              {notes.length ? (
                <>
                  You have <strong className="font-semibold">{notes.length} pages</strong>,{' '}
                  <strong className="font-semibold">{open.length} open tasks</strong>
                  {hasDaily ? (
                    <>
                      , and <strong className="font-semibold">today's note is ready</strong>.
                    </>
                  ) : (
                    <>
                      {' '}
                      — <strong className="font-semibold">today's note isn't started yet</strong>.
                    </>
                  )}
                </>
              ) : (
                <>Welcome — create your first page and I'll keep the overview here.</>
              )}
              <span
                className="ml-[3px] inline-block h-[18px] w-[2px] align-[-3px]"
                style={{ backgroundColor: 'var(--dt-primary)', animation: 'biseo-caret 1.1s steps(1) infinite' }}
              />
            </p>
            <div className="flex items-center gap-2">
              <button
                className="flex h-[30px] items-center rounded-lg bg-(--dt-primary) px-3.5 text-[13px] font-medium text-white shadow-[0_4px_10px_-4px_rgba(0,122,255,0.6)] transition-opacity hover:opacity-90"
                onClick={() => void openDailyNote()}
              >
                {hasDaily ? "Open today's plan" : "Start today's plan"}
              </button>
              <span className="ml-auto text-xs opacity-50">Ask a follow-up ⌘J</span>
            </div>
          </div>
        </div>

        {/* Widget grid. */}
        <div className="grid grid-cols-3 gap-4" style={{ animation: 'biseo-lift 200ms ease-out 30ms both' }}>
          {/* Todo — real, checkboxes work. */}
          <div className={CARD}>
            <div className="flex items-baseline">
              <span className={CARD_TITLE}>Todo</span>
              <span className={`ml-auto ${MUTED}`}>{open.length} open</span>
            </div>
            <div className="flex flex-col gap-2.5">
              {todos.slice(0, 5).map(todo => (
                <button
                  key={`${todo.path}:${todo.line}`}
                  className="group flex items-center gap-2 text-left"
                  onClick={() => {
                    void window.hermesDesktop.vault.toggleTodo(todo.path, todo.line).then(ok => {
                      if (ok) {
                        setTodos(current =>
                          current.map(item =>
                            item.path === todo.path && item.line === todo.line ? { ...item, done: !item.done } : item
                          )
                        )
                      }
                    })
                  }}
                  title={todo.path}
                >
                  <span
                    className="grid size-[15px] shrink-0 place-items-center rounded-[5px] border-[1.5px] transition-colors"
                    style={
                      todo.done
                        ? { backgroundColor: 'var(--dt-primary)', borderColor: 'var(--dt-primary)' }
                        : { borderColor: 'rgba(120,120,128,0.35)' }
                    }
                  >
                    {todo.done ? (
                      <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2.5 6.3 4.8 8.6 9.5 3.6" />
                      </svg>
                    ) : null}
                  </span>
                  <span className={`truncate text-[13px] ${todo.done ? 'line-through opacity-45' : ''}`}>{todo.text}</span>
                </button>
              ))}
              {!todos.length && <span className={MUTED}>No tasks yet — type “/” → To-do list in any note.</span>}
            </div>
          </div>

          {/* Recent notes — real. */}
          <div className={CARD}>
            <div className="flex items-baseline">
              <span className={CARD_TITLE}>Recent notes</span>
              <button className="ml-auto text-xs text-(--dt-primary) hover:opacity-70" onClick={() => openNoteFromHome(recent[0]?.path ?? '')}>
                Open latest
              </button>
            </div>
            <div className="flex flex-col gap-3">
              {recent.map(note => (
                <button key={note.path} className="flex flex-col gap-0.5 text-left" onClick={() => openNoteFromHome(note.path)}>
                  <span className="truncate text-[13px] font-medium">{note.title}</span>
                  <span className={MUTED}>Edited {editedAgo(note.mtimeMs)}</span>
                </button>
              ))}
              {!recent.length && <span className={MUTED}>Nothing yet — ⌘N creates your first page.</span>}
            </div>
          </div>

          {/* Today — daily note state. */}
          <div className={CARD}>
            <div className="flex items-baseline">
              <span className={CARD_TITLE}>Today</span>
              <span className={`ml-auto ${MUTED}`}>{todayStamp()}</span>
            </div>
            {hasDaily ? (
              <button className="flex flex-col gap-1 text-left" onClick={() => void openDailyNote()}>
                <span className="text-[13px] font-medium text-(--dt-primary)">Open today's note →</span>
                <span className={MUTED}>Your plan, tasks and log for the day.</span>
              </button>
            ) : (
              <button className="flex flex-col gap-1 text-left" onClick={() => void openDailyNote()}>
                <span className="text-[13px] font-medium">Start today's note</span>
                <span className={MUTED}>⌘D any time — the Daily template fills it in.</span>
              </button>
            )}
          </div>

          {/* Coming-soon modules — designed cards, honest state. */}
          {[
            { title: 'Inbox', hint: 'Mail lands here once connected.' },
            { title: 'Money', hint: 'Track spending from your notes — coming soon.' },
            { title: 'Meetings', hint: 'Record → transcript → summary — coming soon.' }
          ].map(module => (
            <div key={module.title} className={`${CARD} opacity-75`}>
              <div className="flex items-baseline">
                <span className={CARD_TITLE}>{module.title}</span>
                <span className={`ml-auto ${MUTED}`}>soon</span>
              </div>
              <span className={MUTED}>{module.hint}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
