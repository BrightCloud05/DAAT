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
import {
  type CalendarEntry,
  collectEntries,
  monthGrid,
  monthLabel,
  stampOf,
  type TableLikeRow
} from './calendar'
import { applyTemplateToActive, listTemplates } from './templates'
import { $vaultTodos, initTodosStore, toggleTodo } from './todos-store'
import { closeTableView } from './view-store'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const KIND_TONE: Record<CalendarEntry['kind'], string> = {
  task: 'rgba(255,149,0,0.20)',
  daily: 'rgba(10,132,255,0.16)',
  note: 'rgba(120,120,128,0.16)'
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

  initTodosStore()

  useEffect(() => {
    let cancelled = false

    void window.hermesDesktop.vault
      .propertiesTable()
      .then(data => {
        if (!cancelled) {
          setRows(data)
        }
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [revision])

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

    if (!opened || opened.content.trim()) {
      return
    }

    const daily = (await listTemplates()).find(template => template.name.toLowerCase() === 'daily')

    if (daily) {
      await applyTemplateToActive(daily.path, date)
    }
  }

  const selectedEntries = selected ? (entries.get(selected) ?? []) : []

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[64rem] flex-col px-6 pb-12 pt-8">
        <div className="mb-5 flex items-center gap-3">
          <h1 className="text-[28px] font-bold tracking-tight">{monthLabel(cursor.year, cursor.month)}</h1>

          <div className="ml-auto flex items-center gap-1">
            <button
              className="grid size-7 place-items-center rounded-md opacity-60 transition-all hover:bg-(--ui-control-hover-background) hover:opacity-100"
              onClick={() => step(-1)}
              title="Previous month"
            >
              <Codicon name="chevron-left" className="text-[13px]" />
            </button>
            <button
              className="rounded-md px-2 py-1 text-[12.5px] opacity-70 transition-all hover:bg-(--ui-control-hover-background) hover:opacity-100"
              onClick={() => {
                const now = new Date()

                setCursor({ year: now.getFullYear(), month: now.getMonth() })
                setSelected(today)
              }}
            >
              Today
            </button>
            <button
              className="grid size-7 place-items-center rounded-md opacity-60 transition-all hover:bg-(--ui-control-hover-background) hover:opacity-100"
              onClick={() => step(1)}
              title="Next month"
            >
              <Codicon name="chevron-right" className="text-[13px]" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 border-l border-t border-(--stroke-nous)">
          {WEEKDAYS.map(day => (
            <div
              key={day}
              className="border-b border-r border-(--stroke-nous) px-2 py-1 text-[11.5px] font-medium opacity-50"
            >
              {day}
            </div>
          ))}

          {weeks.flat().map(cell => {
            const dayEntries = entries.get(cell.date) ?? []
            const isSelected = selected === cell.date

            return (
              <button
                key={cell.date}
                onClick={() => setSelected(cell.date)}
                onDoubleClick={() => void openDay(cell.date)}
                className={cn(
                  'flex min-h-[92px] flex-col items-stretch gap-1 border-b border-r border-(--stroke-nous) p-1.5 text-left transition-colors',
                  !cell.inMonth && 'opacity-35',
                  isSelected
                    ? 'bg-[color-mix(in_srgb,var(--dt-primary)_8%,transparent)]'
                    : 'hover:bg-(--ui-control-hover-background)'
                )}
              >
                <span
                  className={cn(
                    'grid size-[20px] shrink-0 place-items-center rounded-full text-[12px]',
                    cell.isToday ? 'bg-(--dt-primary) font-semibold text-white' : 'opacity-70'
                  )}
                >
                  {cell.day}
                </span>

                {dayEntries.slice(0, 3).map(entry => (
                  <span
                    key={`${entry.kind}-${entry.path}-${entry.line ?? 0}`}
                    className={cn(
                      'truncate rounded px-1 py-px text-[11.5px]',
                      entry.done && 'line-through opacity-50'
                    )}
                    style={{ backgroundColor: KIND_TONE[entry.kind] }}
                    title={entry.label}
                  >
                    {entry.label}
                  </span>
                ))}

                {dayEntries.length > 3 ? (
                  <span className="px-1 text-[11px] opacity-50">+{dayEntries.length - 3} more</span>
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
                Open this day's note
              </button>
            </div>

            {selectedEntries.length ? (
              <div className="flex flex-col">
                {selectedEntries.map(entry => (
                  <div
                    key={`${entry.kind}-${entry.path}-${entry.line ?? 0}`}
                    className="group flex items-center gap-2 border-b border-(--stroke-nous) py-1.5 last:border-b-0"
                  >
                    {entry.kind === 'task' ? (
                      <button
                        className="grid size-[15px] shrink-0 place-items-center rounded-[5px] border-[1.5px] transition-colors"
                        style={
                          entry.done
                            ? { backgroundColor: 'var(--dt-primary)', borderColor: 'var(--dt-primary)' }
                            : { borderColor: 'rgba(120,120,128,0.35)' }
                        }
                        onClick={() => {
                          const todo = todos.find(item => item.path === entry.path && item.line === entry.line)

                          if (todo) {
                            void toggleTodo(todo)
                          }
                        }}
                        title={entry.done ? 'Mark as not done' : 'Mark as done'}
                      >
                        {entry.done ? (
                          <svg
                            width="9"
                            height="9"
                            viewBox="0 0 12 12"
                            fill="none"
                            stroke="#fff"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M2.5 6.3 4.8 8.6 9.5 3.6" />
                          </svg>
                        ) : null}
                      </button>
                    ) : (
                      <Codicon
                        name={entry.kind === 'daily' ? 'calendar' : 'file'}
                        className="shrink-0 text-[13px] opacity-45"
                      />
                    )}

                    <button
                      className={cn('min-w-0 flex-1 truncate text-left text-[13px]', entry.done && 'line-through opacity-50')}
                      onClick={() => {
                        closeTableView()
                        void openNote(entry.path)
                      }}
                    >
                      {entry.label}
                    </button>

                    <span className="shrink-0 text-[11.5px] opacity-40">{entry.path.split('/')[0]}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px] opacity-55">
                Nothing scheduled. Give a note a <code className="opacity-80">due:</code> property, or add{' '}
                <code className="opacity-80">📅 {selected}</code> to a task, and it shows up here.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
