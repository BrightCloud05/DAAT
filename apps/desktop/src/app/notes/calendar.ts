/**
 * Calendar logic — a lens over notes that already carry dates, not a new
 * store. Three honest sources, no invented data:
 *
 *   1. Daily notes (`Daily/YYYY-MM-DD.md`) — the day itself.
 *   2. Any note whose frontmatter has a date-ish property (date, due, when,
 *      start, deadline, scheduled).
 *   3. Checkbox tasks with a due date, using the same markers the Todo
 *      screen reads.
 *
 * That means the agent schedules things by writing a normal property into a
 * normal file, and the user can too — with any editor, forever.
 */

export interface CalendarEntry {
  kind: 'daily' | 'note' | 'task'
  /** YYYY-MM-DD */
  date: string
  label: string
  path: string
  /** Task line number, for toggling. */
  line?: number
  done?: boolean
}

export interface DayCell {
  date: string
  day: number
  inMonth: boolean
  isToday: boolean
}

const DAILY_RE = /(?:^|\/)(\d{4}-\d{2}-\d{2})\.(?:md|markdown)$/i
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})/
/** Frontmatter keys that mean "this note belongs to a day". */
const DATE_KEYS = ['date', 'due', 'when', 'start', 'deadline', 'scheduled']

export function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function stampOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** First ISO date inside a frontmatter value, or null. Values are unknown-typed. */
export function dateFromValue(value: unknown): string | null {
  if (value instanceof Date) {
    return stampOf(value)
  }

  if (typeof value !== 'string' && typeof value !== 'number') {
    return null
  }

  const match = ISO_RE.exec(String(value).trim())

  if (!match) {
    return null
  }

  const [, year, month, day] = match
  const monthNumber = Number(month)
  const dayNumber = Number(day)

  // Reject 2026-13-40: it would render in a month the user never picked.
  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) {
    return null
  }

  return `${year}-${month}-${day}`
}

/** Weeks (Sun-first) covering the given month, padded with adjacent days. */
export function monthGrid(year: number, month: number, today = stampOf(new Date())): DayCell[][] {
  const first = new Date(year, month, 1)
  const start = new Date(year, month, 1 - first.getDay())
  const weeks: DayCell[][] = []

  for (let week = 0; week < 6; week++) {
    const cells: DayCell[] = []

    for (let day = 0; day < 7; day++) {
      const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate() + week * 7 + day)
      const date = stampOf(cursor)

      cells.push({
        date,
        day: cursor.getDate(),
        inMonth: cursor.getMonth() === month,
        isToday: date === today
      })
    }

    weeks.push(cells)

    // A 6th row is only needed when the month actually reaches into it.
    if (week === 4 && !cells.some(cell => cell.inMonth)) {
      weeks.pop()
      break
    }
  }

  return weeks
}

export function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

export interface TableLikeRow {
  path: string
  title: string
  props: Record<string, unknown>
  /** Present on rows from propertiesTable(); absent in hand-built test rows. */
  mtimeMs?: number
}

export interface TodoLike {
  path: string
  line: number
  text: string
  done: boolean
}

/**
 * A task's due date, written inline: `📅 2026-08-01`, `due:2026-08-01`, or
 * `@2026-08-01`. Exported because the Todo screen and the home briefing read
 * the same tasks — three private copies of one rule is how they drift.
 */
export const DUE_RE = /(?:📅\s*|due:\s*|@)(\d{4}-\d{2}-\d{2})/i

/** The date a task is due, or null when it carries none. */
export function dueOf(text: string): string | null {
  return DUE_RE.exec(text)?.[1] ?? null
}

/** The task text with its date marker removed, for display. */
export function taskLabel(text: string): string {
  return text.replace(DUE_RE, '').replace(/\s+/g, ' ').trim()
}

function noteName(path: string): string {
  return path.split('/').pop()?.replace(/\.(md|markdown)$/i, '') ?? path
}

/** Group everything dated into `date -> entries`. */
export function collectEntries(rows: TableLikeRow[], todos: TodoLike[]): Map<string, CalendarEntry[]> {
  const byDate = new Map<string, CalendarEntry[]>()

  const push = (entry: CalendarEntry) => {
    const list = byDate.get(entry.date)

    if (list) {
      list.push(entry)
    } else {
      byDate.set(entry.date, [entry])
    }
  }

  for (const row of rows) {
    const daily = DAILY_RE.exec(row.path)

    if (daily) {
      push({ kind: 'daily', date: daily[1], label: row.title || noteName(row.path), path: row.path })

      // A daily note is already placed by its name; a `date:` property
      // repeating that would show the same note twice on the same day.
      continue
    }

    for (const key of DATE_KEYS) {
      const date = dateFromValue(row.props[key])

      if (date) {
        push({ kind: 'note', date, label: row.title || noteName(row.path), path: row.path })
        break
      }
    }
  }

  for (const todo of todos) {
    const match = DUE_RE.exec(todo.text)

    if (!match) {
      continue
    }

    push({
      kind: 'task',
      date: match[1],
      label: todo.text.replace(DUE_RE, '').replace(/\s{2,}/g, ' ').trim(),
      path: todo.path,
      line: todo.line,
      done: todo.done
    })
  }

  // Tasks first (they're actionable), then notes; stable by label after that.
  for (const list of byDate.values()) {
    list.sort((a, b) => {
      const rank = (entry: CalendarEntry) => (entry.kind === 'task' ? 0 : entry.kind === 'daily' ? 1 : 2)

      return rank(a) - rank(b) || a.label.localeCompare(b.label)
    })
  }

  return byDate
}
