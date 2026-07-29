/**
 * Home dashboard — implementation of "Daat Home.dc.html" (design 1a).
 *
 * Every card reads the user's real files: tasks and dates out of their
 * notes, mail from their own account, money from the month's ledger note.
 * A card with nothing behind it yet says so plainly rather than showing a
 * plausible number — a dashboard that invents figures is worse than none.
 */

import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useState } from 'react'

import { activeGateway } from '@/store/gateway'

import { $vaultInfo, $vaultNotes, $vaultRevision, openNote } from '../vault/store'
import { collectEntries, type TableLikeRow } from './calendar'
import { formatAmount, MONEY_DIR, type MoneySummary, parseMonthNote, summarize } from './money'
import { PersonaWidgets } from './persona-widgets'
import { isTemplateNote, openDailyNote, todayStamp } from './templates'
import { $vaultTodos, initTodosStore, toggleTodo } from './todos-store'
import { closeTableView, openCalendarView, openMailView, openMeetingsView, openMoneyView } from './view-store'
import { $productLocale, productStrings } from './strings'

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

/** Next few dated things, from the same source the Calendar reads. */
function UpNextCard() {
  const s = productStrings(useStore($productLocale))
  const revision = useStore($vaultRevision)
  const todos = useStore($vaultTodos)
  const [rows, setRows] = useState<TableLikeRow[]>([])

  useEffect(() => {
    let cancelled = false

    void window.hermesDesktop.vault
      .propertiesTable()
      .then(data => !cancelled && setRows(data))
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [revision])

  const upcoming = useMemo(() => {
    const today = todayStamp()

    return [...collectEntries(rows, todos).entries()]
      .filter(([date]) => date >= today)
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([date, entries]) => entries.filter(entry => !entry.done).map(entry => ({ date, entry })))
      .slice(0, 4)
  }, [rows, todos])

  return (
    <div className={CARD}>
      <div className="flex items-baseline">
        <span className={CARD_TITLE}>{s.upNext}</span>
        <button className="ml-auto text-xs text-(--dt-primary) hover:opacity-70" onClick={openCalendarView}>
          {s.calendar}
        </button>
      </div>
      <div className="flex flex-col gap-2.5">
        {upcoming.map(({ date, entry }) => (
          <button
            key={`${date}-${entry.path}-${entry.line ?? 0}`}
            className="flex items-baseline gap-2 text-left"
            onClick={() => {
              closeTableView()
              void openNote(entry.path)
            }}
          >
            <span className="shrink-0 text-[11.5px] opacity-45">{date === todayStamp() ? 'Today' : date.slice(5)}</span>
            <span className="truncate text-[13px]">{entry.label}</span>
          </button>
        ))}
        {!upcoming.length && <span className={MUTED}>{s.nothingScheduled}</span>}
      </div>
    </div>
  )
}

/** Real inbox state, or an honest "not connected yet". */
function InboxCard() {
  const s = productStrings(useStore($productLocale))
  const [state, setState] = useState<{ connected: boolean; mail: MailEnvelope[] } | null>(null)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const status = await window.hermesDesktop.mail.status()

        if (!status.installed || !status.accounts.length) {
          if (!cancelled) setState({ connected: false, mail: [] })

          return
        }

        const mail = await window.hermesDesktop.mail.list({ limit: 5 })

        if (!cancelled) setState({ connected: true, mail })
      } catch {
        if (!cancelled) setState({ connected: false, mail: [] })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const unread = state?.mail.filter(item => !item.seen) ?? []

  return (
    <div className={CARD}>
      <div className="flex items-baseline">
        <span className={CARD_TITLE}>{s.inbox}</span>
        {state?.connected ? (
          <span className={`ml-auto ${MUTED}`}>{s.unreadCount(unread.length)}</span>
        ) : (
          <button className="ml-auto text-xs text-(--dt-primary) hover:opacity-70" onClick={openMailView}>
            {s.connect}
          </button>
        )}
      </div>
      <div className="flex flex-col gap-2.5">
        {state === null ? (
          <span className={MUTED}>{s.loading}</span>
        ) : state.connected ? (
          <>
            {state.mail.slice(0, 3).map(item => (
              <button key={item.id} className="flex flex-col gap-0.5 text-left" onClick={openMailView}>
                <span className="truncate text-[13px]">{item.subject || '(no subject)'}</span>
                <span className={MUTED}>{item.fromName || item.fromAddr || 'unknown'}</span>
              </button>
            ))}
            {!state.mail.length && <span className={MUTED}>{s.inboxEmpty}</span>}
          </>
        ) : (
          <span className={MUTED}>{s.connectMailHint}</span>
        )}
      </div>
    </div>
  )
}

/** This month's totals, straight out of the month note. */
function MoneyCard() {
  const s = productStrings(useStore($productLocale))
  const revision = useStore($vaultRevision)
  const [totals, setTotals] = useState<MoneySummary | null>(null)

  useEffect(() => {
    let cancelled = false
    const month = todayStamp().slice(0, 7)
    const relPath = `${MONEY_DIR}/${month}.md`

    void window.hermesDesktop.vault
      .read(relPath)
      .then(note => !cancelled && setTotals(summarize(parseMonthNote(relPath, note.content))))
      .catch(() => !cancelled && setTotals(null))

    return () => {
      cancelled = true
    }
  }, [revision])

  return (
    <div className={CARD}>
      <div className="flex items-baseline">
        <span className={CARD_TITLE}>{s.money}</span>
        <button className="ml-auto text-xs text-(--dt-primary) hover:opacity-70" onClick={openMoneyView}>
          {totals ? s.openTheNote : s.dropStatement}
        </button>
      </div>
      {totals && (totals.income || totals.spend) ? (
        <div className="flex flex-col gap-1">
          <span className="text-[19px] font-semibold" style={{ color: totals.net >= 0 ? '#1F7A3D' : '#C0392B' }}>
            {formatAmount(totals.net)}
          </span>
          <span className={MUTED}>
            {formatAmount(totals.income)} in · {formatAmount(-totals.spend)} out this month
          </span>
        </div>
      ) : (
        <span className={MUTED}>{s.moneyHint}</span>
      )}
    </div>
  )
}

export function HomeView() {
  const s = productStrings(useStore($productLocale))
  const notes = useStore($vaultNotes)
  const info = useStore($vaultInfo)
  const todos = useStore($vaultTodos)
  const [aiConnected, setAiConnected] = useState(false)

  initTodosStore()

  useEffect(() => {
    const check = () => setAiConnected(activeGateway()?.connectionState === 'open')

    check()

    const timer = setInterval(check, 5_000)

    return () => clearInterval(timer)
  }, [])

  const open = todos.filter(todo => !todo.done)
  // Templates are source, not pages — and their unsubstituted "{{title}}"
  // heading is what the indexer reads as a title.
  const recent = [...notes]
    .filter(note => !isTemplateNote(note.path))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 3)
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
            animation: 'daat-lift 200ms ease-out both'
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
                style={{ backgroundColor: 'var(--dt-primary)', animation: 'daat-caret 1.1s steps(1) infinite' }}
              />
            </p>
            <div className="flex items-center gap-2">
              <button
                className="flex h-[30px] items-center rounded-lg bg-(--dt-primary) px-3.5 text-[13px] font-medium text-white shadow-[0_4px_10px_-4px_rgba(0,122,255,0.6)] transition-opacity hover:opacity-90"
                onClick={() => void openDailyNote()}
              >
                {hasDaily ? s.openTodaysPlan : s.startTodaysPlan}
              </button>
              <span className="ml-auto text-xs opacity-50">Ask a follow-up ⌘J</span>
            </div>
          </div>
        </div>

        {/* Widget grid. */}
        <div className="grid grid-cols-3 gap-4" style={{ animation: 'daat-lift 200ms ease-out 30ms both' }}>
          {/* Todo — real, checkboxes work. */}
          <div className={CARD}>
            <div className="flex items-baseline">
              <span className={CARD_TITLE}>{s.todo}</span>
              <span className={`ml-auto ${MUTED}`}>{s.openCount(open.length)}</span>
            </div>
            <div className="flex flex-col gap-2.5">
              {todos.slice(0, 5).map(todo => (
                <button
                  key={`${todo.path}:${todo.line}`}
                  className="group flex items-center gap-2 text-left"
                  onClick={() => void toggleTodo(todo)}
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
              {!todos.length && <span className={MUTED}>{s.noTasksYet}</span>}
            </div>
          </div>

          {/* Recent notes — real. */}
          <div className={CARD}>
            <div className="flex items-baseline">
              <span className={CARD_TITLE}>{s.recentNotes}</span>
              {recent.length ? (
                <button
                  className="ml-auto text-xs text-(--dt-primary) hover:opacity-70"
                  onClick={() => openNoteFromHome(recent[0].path)}
                >
                  {s.openLatest}
                </button>
              ) : null}
            </div>
            <div className="flex flex-col gap-3">
              {recent.map(note => (
                <button key={note.path} className="flex flex-col gap-0.5 text-left" onClick={() => openNoteFromHome(note.path)}>
                  <span className="truncate text-[13px] font-medium">{note.title}</span>
                  <span className={MUTED}>Edited {editedAgo(note.mtimeMs)}</span>
                </button>
              ))}
              {!recent.length && <span className={MUTED}>{s.noNotesYet}</span>}
            </div>
          </div>

          {/* Today — daily note state. */}
          <div className={CARD}>
            <div className="flex items-baseline">
              <span className={CARD_TITLE}>{s.today}</span>
              <span className={`ml-auto ${MUTED}`}>{todayStamp()}</span>
            </div>
            {hasDaily ? (
              <button className="flex flex-col gap-1 text-left" onClick={() => void openDailyNote()}>
                <span className="text-[13px] font-medium text-(--dt-primary)">{s.openTodaysNote}</span>
                <span className={MUTED}>Your plan, tasks and log for the day.</span>
              </button>
            ) : (
              <button className="flex flex-col gap-1 text-left" onClick={() => void openDailyNote()}>
                <span className="text-[13px] font-medium">{s.startTodaysNote}</span>
                <span className={MUTED}>⌘D any time — the Daily template fills it in.</span>
              </button>
            )}
          </div>

          {/* Persona-specific cards first: for a student, today's classes and
              what's due beat a generic "up next". */}
          <PersonaWidgets />
          <UpNextCard />
          <InboxCard />
          <MoneyCard />

          <div className={CARD}>
            <div className="flex items-baseline">
              <span className={CARD_TITLE}>{s.meetings}</span>
              <button className="ml-auto text-xs text-(--dt-primary) hover:opacity-70" onClick={openMeetingsView}>
                {s.startRecording}
              </button>
            </div>
            <span className={MUTED}>{s.meetingsHint}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
