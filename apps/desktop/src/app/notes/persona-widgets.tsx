/**
 * Dashboard cards that only some personas get.
 *
 * Each one is a lens over notes the persona's own templates produce — a
 * Student gets a Courses card because they also get a Course template whose
 * frontmatter the card reads. Nothing here invents data: a card with no
 * matching notes says what to create instead of showing a plausible number.
 */

import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useState } from 'react'

import { cn } from '@/lib/utils'

import { $vaultRevision, openNote } from '../vault/store'

import { dateFromValue, stampOf, type TableLikeRow } from './calendar'
import { $persona } from './persona-store'
import type { PersonaWidgetId } from './personas'
import { $productLocale, productStrings } from './strings'
import { $vaultTodos } from './todos-store'
import { closeTableView } from './view-store'

const CARD =
  'rounded-xl border border-(--stroke-nous) bg-(--dt-card) p-[18px] flex flex-col gap-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_10px_24px_-18px_rgba(0,0,0,0.22)]'

const CARD_TITLE = 'text-[13px] font-semibold'
const MUTED = 'text-xs opacity-50'

/** Weekday names as they appear in a Course note's `days:` list. */
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

function useTable(): TableLikeRow[] {
  const revision = useStore($vaultRevision)
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

  return rows
}

function ofType(rows: TableLikeRow[], type: string): TableLikeRow[] {
  return rows.filter(row => String(row.props.type ?? '').toLowerCase() === type)
}

function open(path: string): void {
  closeTableView()
  void openNote(path)
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={CARD}>
      <div className="flex items-baseline">
        <span className={CARD_TITLE}>{title}</span>
        {action ? <span className="ml-auto text-xs">{action}</span> : null}
      </div>
      <div className="flex flex-col gap-2.5">{children}</div>
    </div>
  )
}

/** Today's classes, from Course notes' `days:` and `time:`. */
function CoursesCard() {
  const rows = useTable()
  const s = productStrings(useStore($productLocale))
  const courses = useMemo(() => ofType(rows, 'course'), [rows])

  const todayKey = WEEKDAY_KEYS[new Date().getDay()]

  const todays = courses
    .filter(course => {
      const days = course.props.days

      // `days: [Mon, Wed]` parses as a list; a bare string is fine too.
      const list = Array.isArray(days) ? days : typeof days === 'string' ? days.split(/[,\s]+/) : []

      return list.some(day => String(day).trim().toLowerCase().startsWith(todayKey))
    })
    .sort((a, b) => String(a.props.time ?? '').localeCompare(String(b.props.time ?? '')))

  return (
    <Card action={<span className={MUTED}>{s.courseCount(courses.length)}</span>} title={s.courses}>
      {!courses.length ? (
        <span className={MUTED}>{s.noCoursesYet}</span>
      ) : todays.length ? (
        todays.map(course => (
          <button className="flex items-baseline gap-2 text-left" key={course.path} onClick={() => open(course.path)}>
            <span className="shrink-0 text-[11.5px] tabular-nums opacity-45">
              {String(course.props.time ?? '').trim() || '—'}
            </span>
            <span className="truncate text-[13px]">{course.title || course.path}</span>
            {course.props.room ? (
              <span className="ml-auto shrink-0 text-[11.5px] opacity-40">{String(course.props.room)}</span>
            ) : null}
          </button>
        ))
      ) : (
        <span className={MUTED}>{s.noClassesToday}</span>
      )}
    </Card>
  )
}

/** Assessments by how close they are, with the overdue ones first. */
function AssessmentsCard() {
  const rows = useTable()
  const todos = useStore($vaultTodos)
  const s = productStrings(useStore($productLocale))
  const today = stampOf(new Date())

  const items = useMemo(() => {
    const fromNotes = ofType(rows, 'assessment')
      .map(row => ({
        path: row.path,
        title: row.title || row.path,
        due: dateFromValue(row.props.due),
        status: String(row.props.status ?? '').toLowerCase(),
        course: String(row.props.course ?? '')
      }))
      .filter(item => item.due && item.status !== 'done' && item.status !== 'submitted')

    return fromNotes.sort((a, b) => (a.due ?? '').localeCompare(b.due ?? '')).slice(0, 5)
  }, [rows])

  /** "3 days" / "today" / "2 days late" — the only number a student wants. */
  const distance = (due: string): { text: string; tone?: string } => {
    const days = Math.round((new Date(due).getTime() - new Date(today).getTime()) / 86_400_000)

    if (days < 0) {return { text: s.daysLate(Math.abs(days)), tone: '#C0392B' }}

    if (days === 0) {return { text: s.dueToday, tone: '#C0392B' }}

    if (days <= 7) {return { text: s.inDays(days), tone: '#B26A00' }}

    return { text: s.inDays(days) }
  }

  const unfinished = todos.filter(todo => !todo.done).length

  return (
    <Card action={<span className={MUTED}>{s.openCount(unfinished)}</span>} title={s.assessments}>
      {items.length ? (
        items.map(item => {
          const badge = item.due ? distance(item.due) : null

          return (
            <button className="flex items-baseline gap-2 text-left" key={item.path} onClick={() => open(item.path)}>
              <span className="min-w-0 flex-1 truncate text-[13px]">{item.title}</span>
              {item.course ? <span className="shrink-0 text-[11.5px] opacity-40">{item.course}</span> : null}
              {badge ? (
                <span
                  className={cn('shrink-0 text-[11.5px]', !badge.tone && 'opacity-45')}
                  style={badge.tone ? { color: badge.tone } : undefined}
                >
                  {badge.text}
                </span>
              ) : null}
            </button>
          )
        })
      ) : (
        <span className={MUTED}>{s.noAssessmentsYet}</span>
      )}
    </Card>
  )
}

/** Generic "notes of this type, most recent first" card. */
function TypeCard({ type, title, empty }: { type: string; title: string; empty: string }) {
  const rows = useTable()

  const items = useMemo(() => ofType(rows, type)
        .sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0))
        .slice(0, 4), [rows, type])

  return (
    <Card title={title}>
      {items.length ? (
        items.map(item => (
          <button className="flex items-baseline gap-2 text-left" key={item.path} onClick={() => open(item.path)}>
            <span className="min-w-0 flex-1 truncate text-[13px]">{item.title || item.path}</span>
            {item.props.status ? (
              <span className="shrink-0 text-[11.5px] opacity-40">{String(item.props.status)}</span>
            ) : null}
          </button>
        ))
      ) : (
        <span className={MUTED}>{empty}</span>
      )}
    </Card>
  )
}

/** Tasks whose text says someone else owes you something. */
function WaitingOnCard() {
  const todos = useStore($vaultTodos)
  const s = productStrings(useStore($productLocale))
  const waiting = todos.filter(todo => !todo.done && /waiting on|waiting for|blocked by/i.test(todo.text)).slice(0, 5)

  return (
    <Card title={s.waitingOn}>
      {waiting.length ? (
        waiting.map(todo => (
          <button
            className="truncate text-left text-[13px]"
            key={`${todo.path}:${todo.line}`}
            onClick={() => open(todo.path)}
          >
            {todo.text}
          </button>
        ))
      ) : (
        <span className={MUTED}>{s.nothingWaiting}</span>
      )}
    </Card>
  )
}

export function PersonaWidgets() {
  const persona = useStore($persona)
  const s = productStrings(useStore($productLocale))

  if (!persona?.widgets.length) {
    return null
  }

  const render = (id: PersonaWidgetId) => {
    switch (id) {
      case 'courses':
        return <CoursesCard key={id} />

      case 'assessments':
        return <AssessmentsCard key={id} />

      case 'clients':
        return <TypeCard empty={s.noClientsYet} key={id} title={s.clients} type="client" />

      case 'projects':
        return <TypeCard empty={s.noProjectsYet} key={id} title={s.projects} type="project" />

      case 'waitingOn':
        return <WaitingOnCard key={id} />

      default:
        return null
    }
  }

  return <>{persona.widgets.map(render)}</>
}
