/**
 * Calendar screen — the month, built from notes that already carry dates.
 *
 * Clicking a day opens (or creates) that day's note, so the calendar is a way
 * into writing rather than a separate thing to maintain. Nothing here is a
 * second copy of your data: move a `due:` property and the calendar moves.
 */

import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useState } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

import { $vaultRevision, createNote, openNote } from '../vault/store'

import { type CalendarEntry, collectEntries, monthGrid, stampOf, type TableLikeRow } from './calendar'
import { EntryDateButton, QuickAddRow, SubscriptionsPanel } from './quick-event'
import { $productLocale, productStrings } from './strings'
import { applyTemplateToActive, listTemplates } from './templates'
import { $vaultTodos, initTodosStore, toggleTodo } from './todos-store'
import { closeTableView } from './view-store'

const KIND_TONE: Record<CalendarEntry['kind'], string> = {
  task: 'var(--sem-soon-wash)',
  daily: 'var(--ui-control-active-background)',
  note: 'var(--ui-control-hover-background)'
}

export function CalendarView() {
  const revision = useStore($vaultRevision)
  const todos = useStore($vaultTodos)
  const today = stampOf(new Date())

  const [cursor, setCursor] = useState(() => {
    const now = new Date()

    return { year: now.getFullYear(), month: now.getMonth() }
  })

  const [rows, setRows] = useState<TableLikeRow[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [showSubscriptions, setShowSubscriptions] = useState(false)
  const locale = useStore($productLocale)
  const s = productStrings(locale)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)

  const weekdays = Array.from({ length: 7 }, (_, day) =>
    new Date(2024, 0, 7 + day).toLocaleDateString(locale, { weekday: 'short' })
  )

  initTodosStore()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    void window.hermesDesktop.vault
      .propertiesTable()
      .then(data => {
        if (!cancelled) {
          setRows(data)
        }
      })
      .catch(cause => {
        if (!cancelled) {setError(cause instanceof Error ? cause.message : String(cause))}
      })
      .finally(() => {
        if (!cancelled) {setLoading(false)}
      })

    return () => {
      cancelled = true
    }
  }, [revision, retry])

  const entries = useMemo(() => collectEntries(rows, todos), [rows, todos])
  const weeks = useMemo(() => monthGrid(cursor.year, cursor.month, today), [cursor, today])

  const step = (delta: number) => {
    const next = new Date(cursor.year, cursor.month + delta, 1)

    setCursor({ year: next.getFullYear(), month: next.getMonth() })
  }

  /** Open a day's note, creating it from the Daily template if it's new. */
  const openDay = async (date: string) => {
    const relPath = `Daily/${date}.md`

    closeTableView()

    const opened = await createNote(relPath)

    // `created`, not blank content — a new note is seeded with a "# Title".
    if (!opened?.created) {
      return
    }

    const daily = (await listTemplates()).find(template => template.name.toLowerCase() === 'daily')

    if (daily) {
      await applyTemplateToActive(daily.path, date, relPath, date)
    }
  }

  const selectedEntries = selected ? (entries.get(selected) ?? []) : []

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[64rem] flex-col px-6 pb-12 pt-8">
        <div className="mb-5 flex items-center gap-3">
          <h1 className="text-[28px] font-(--dt-font-serif) font-medium tracking-[-0.01em]">
            {new Date(cursor.year, cursor.month, 1).toLocaleDateString(locale, { year: 'numeric', month: 'long' })}
          </h1>

          <div className="ml-auto flex items-center gap-1">
            <button
              className="grid size-7 place-items-center rounded-md opacity-60 transition-all hover:bg-(--ui-control-hover-background) hover:opacity-100"
              onClick={() => step(-1)}
              title={s.previousMonth}
            >
              <Codicon className="text-[13px]" name="chevron-left" />
            </button>
            <button
              className="rounded-md px-2 py-1 text-[12.5px] opacity-70 transition-all hover:bg-(--ui-control-hover-background) hover:opacity-100"
              onClick={() => {
                const now = new Date()

                setCursor({ year: now.getFullYear(), month: now.getMonth() })
                setSelected(today)
              }}
              title={s.today}
            >
              {s.today}
            </button>
            <button
              className="grid size-7 place-items-center rounded-md opacity-60 transition-all hover:bg-(--ui-control-hover-background) hover:opacity-100"
              onClick={() => step(1)}
              title={s.nextMonth}
            >
              <Codicon className="text-[13px]" name="chevron-right" />
            </button>
            <button
              className={cn(
                'grid size-7 place-items-center rounded-md opacity-60 transition-all hover:bg-(--ui-control-hover-background) hover:opacity-100',
                showSubscriptions && 'bg-(--ui-control-active-background) opacity-100'
              )}
              onClick={() => setShowSubscriptions(value => !value)}
              title={s.subscriptions}
            >
              <Codicon className="text-[13px]" name="rss" />
            </button>
          </div>
        </div>

        {loading ? (
          <p className="mb-3 text-sm opacity-60" role="status">
            {s.loading}
          </p>
        ) : null}
        {error ? (
          <p className="mb-3 text-sm" role="alert">
            {error}{' '}
            <button className="underline" onClick={() => setRetry(value => value + 1)}>
              {s.retryNow}
            </button>
          </p>
        ) : null}
        {showSubscriptions ? (
          <div className="mb-4">
            <SubscriptionsPanel />
          </div>
        ) : null}

        <div className="grid grid-cols-7 border-l border-t border-(--stroke-nous)">
          {weekdays.map(day => (
            <div
              className="border-b border-r border-(--stroke-nous) px-2 py-1 text-[11.5px] font-medium opacity-50"
              key={day}
            >
              {day}
            </div>
          ))}

          {weeks.flat().map(cell => {
            const dayEntries = entries.get(cell.date) ?? []
            const isSelected = selected === cell.date

            return (
              <button
                aria-current={cell.isToday ? 'date' : undefined}
                aria-label={cell.date}
                aria-pressed={isSelected}
                className={cn(
                  'flex min-h-[92px] flex-col items-stretch gap-1 border-b border-r border-(--stroke-nous) p-1.5 text-left transition-colors',
                  !cell.inMonth && 'opacity-35',
                  isSelected
                    ? 'bg-[color-mix(in_srgb,var(--dt-primary)_8%,transparent)]'
                    : 'hover:bg-(--ui-control-hover-background)'
                )}
                key={cell.date}
                onClick={() => setSelected(cell.date)}
                onDoubleClick={() => void openDay(cell.date)}
              >
                <span
                  className={cn(
                    'grid size-[20px] shrink-0 place-items-center rounded-full text-[12px]',
                    cell.isToday ? 'bg-(--dt-primary) font-semibold text-(--dt-primary-foreground)' : 'opacity-70'
                  )}
                >
                  {cell.day}
                </span>

                {dayEntries.slice(0, 3).map(entry => (
                  <span
                    className={cn('truncate rounded px-1 py-px text-[11.5px]', entry.done && 'line-through opacity-50')}
                    key={`${entry.kind}-${entry.path}-${entry.line ?? 0}`}
                    style={{ backgroundColor: KIND_TONE[entry.kind] }}
                    title={entry.label}
                  >
                    {entry.label}
                  </span>
                ))}

                {dayEntries.length > 3 ? (
                  <span className="px-1 text-[11px] opacity-50">{s.moreEntries(dayEntries.length - 3)}</span>
                ) : null}
              </button>
            )
          })}
        </div>

        {/* Day detail — the calendar's job is to get you into the note. */}
        {selected ? (
          <div className="mt-5">
            <div className="mb-2 flex items-baseline gap-2">
              <h2 className="text-[15px] font-semibold">{selected}</h2>
              <button
                className="ml-auto rounded-md px-2 py-1 text-[12.5px] text-(--dt-primary) transition-opacity hover:opacity-70"
                onClick={() => void openDay(selected)}
              >
                {s.openThisDaysNote}
              </button>
            </div>

            <QuickAddRow date={selected} />

            {selectedEntries.length ? (
              <div className="flex flex-col">
                {selectedEntries.map(entry => (
                  <div
                    className="group flex items-center gap-2 border-b border-(--stroke-nous) py-1.5 last:border-b-0"
                    key={`${entry.kind}-${entry.path}-${entry.line ?? 0}`}
                  >
                    {entry.kind === 'task' ? (
                      <button
                        aria-label={`${entry.done ? s.markNotDone : s.markDone}: ${entry.label}`}
                        aria-pressed={Boolean(entry.done)}
                        className="grid size-[15px] shrink-0 place-items-center rounded-[5px] border-[1.5px] transition-colors"
                        onClick={() => {
                          const todo = todos.find(item => item.path === entry.path && item.line === entry.line)

                          if (todo) {
                            void toggleTodo(todo)
                          }
                        }}
                        style={
                          entry.done
                            ? { backgroundColor: 'var(--dt-primary)', borderColor: 'var(--dt-primary)' }
                            : { borderColor: 'var(--ui-stroke-secondary)' }
                        }
                        title={entry.done ? s.markNotDone : s.markDone}
                      >
                        {entry.done ? (
                          <svg
                            fill="none"
                            height="9"
                            stroke="#fff"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            viewBox="0 0 12 12"
                            width="9"
                          >
                            <path d="M2.5 6.3 4.8 8.6 9.5 3.6" />
                          </svg>
                        ) : null}
                      </button>
                    ) : (
                      <Codicon
                        className="shrink-0 text-[13px] opacity-45"
                        name={entry.kind === 'daily' ? 'calendar' : 'file'}
                      />
                    )}

                    <button
                      className={cn(
                        'min-w-0 flex-1 truncate text-left text-[13px]',
                        entry.done && 'line-through opacity-50'
                      )}
                      onClick={() => {
                        closeTableView()
                        void openNote(entry.path)
                      }}
                    >
                      {entry.label}
                    </button>

                    <EntryDateButton entry={entry} />
                    <span className="shrink-0 text-[11.5px] opacity-40">{entry.path.split('/')[0]}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px] opacity-55">{!loading && !error ? s.nothingScheduled : null}</p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
