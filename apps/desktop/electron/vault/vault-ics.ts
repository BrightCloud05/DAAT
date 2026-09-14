/**
 * vault-ics.ts — calendar subscriptions (ICS URLs, e.g. Google Calendar's
 * "secret address") materialized as vault notes.
 *
 * Events become ordinary markdown files under `Calendar/Sync/` with a
 * `date:` property, so the calendar screen shows them with zero changes:
 * the file watcher indexes them like any other note. Filenames are
 * deterministic (`slug--uid--date.md`), which makes syncing idempotent —
 * two Macs pointed at the same iCloud vault write the same files.
 *
 * Deliberately dependency-free: ICS is line-folded RFC 5545 and we only
 * need DTSTART / SUMMARY / UID / LOCATION / RRULE. Recurrence expansion
 * covers DAILY / WEEKLY / MONTHLY with INTERVAL, COUNT, UNTIL and BYDAY
 * (weekly) inside a bounded window; EXDATE and rarer rules are skipped —
 * an exception therefore still shows on its original day.
 */

import { app, ipcMain } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import type { VaultService } from './vault-service'

export interface IcsSubscription {
  id: string
  name: string
  url: string
  addedAt: number
  lastSyncAt?: number
  lastEventCount?: number
  lastError?: string
}

interface IcsEvent {
  uid: string
  summary: string
  location?: string
  /** Wall-clock occurrence dates, YYYY-MM-DD. */
  dates: string[]
  /** HH:MM when the event is timed, absent for all-day. */
  time?: string
}

const SYNC_DIR = 'Calendar/Sync'
/** Occurrences materialized per event / per feed — keeps the vault sane. */
const WINDOW_BACK_DAYS = 7
const WINDOW_AHEAD_DAYS = 90
const MAX_OCCURRENCES_PER_EVENT = 60
const MAX_FILES_PER_FEED = 800

function stateFile(): string {
  return path.join(app.getPath('userData'), 'calendar-subscriptions.json')
}

export function loadSubscriptions(): IcsSubscription[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile(), 'utf8'))

    return Array.isArray(parsed?.subscriptions) ? parsed.subscriptions : []
  } catch {
    return []
  }
}

function saveSubscriptions(subscriptions: IcsSubscription[]): void {
  fs.mkdirSync(path.dirname(stateFile()), { recursive: true })
  fs.writeFileSync(stateFile(), JSON.stringify({ subscriptions }, null, 2), 'utf8')
}

// ---------------------------------------------------------------------------
// ICS parsing

/** RFC 5545 line unfolding: a line starting with space/tab continues the previous one. */
function unfold(text: string): string[] {
  const out: string[] = []

  for (const raw of text.split(/\r?\n/)) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && out.length) {
      out[out.length - 1] += raw.slice(1)
    } else {
      out.push(raw)
    }
  }

  return out
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function stampOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

interface ParsedStart {
  /** Local wall-clock day of the first occurrence. */
  date: Date
  time?: string
}

/**
 * DTSTART value → wall-clock date (+ time for timed events).
 * `...Z` converts from UTC to this Mac's zone; `TZID=` values are taken as
 * wall clock, which is right whenever the event was created in the user's
 * own timezone (the overwhelmingly common case for a personal calendar).
 */
function parseDtstart(value: string, isUtc: boolean): ParsedStart | null {
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value)

  if (dateOnly) {
    return { date: new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])) }
  }

  const timed = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z?)$/.exec(value)

  if (!timed) {
    return null
  }

  const [, y, mo, d, h, mi] = timed

  if (isUtc || timed[7] === 'Z') {
    const utc = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)))

    return { date: utc, time: `${pad(utc.getHours())}:${pad(utc.getMinutes())}` }
  }

  return {
    date: new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)),
    time: `${h}:${mi}`
  }
}

const BYDAY_TO_DOW: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }

interface Rrule {
  freq: string
  interval: number
  count?: number
  until?: Date
  byday?: number[]
}

function parseRrule(value: string): Rrule | null {
  const parts = new Map<string, string>()

  for (const piece of value.split(';')) {
    const eq = piece.indexOf('=')

    if (eq > 0) {
      parts.set(piece.slice(0, eq).toUpperCase(), piece.slice(eq + 1))
    }
  }

  const freq = parts.get('FREQ')

  if (!freq) {
    return null
  }

  const rule: Rrule = { freq, interval: Math.max(1, Number(parts.get('INTERVAL') ?? 1) || 1) }
  const count = Number(parts.get('COUNT'))

  if (Number.isFinite(count) && count > 0) {
    rule.count = count
  }

  const until = parts.get('UNTIL')

  if (until) {
    const parsed = parseDtstart(until, until.endsWith('Z'))

    if (parsed) {
      rule.until = parsed.date
    }
  }

  const byday = parts.get('BYDAY')

  if (byday) {
    const days = byday
      .split(',')
      // Ordinals like `2TU` (2nd Tuesday) are monthly-only; keep the weekday.
      .map(token => BYDAY_TO_DOW[token.replace(/^[+-]?\d+/, '')])
      .filter((dow): dow is number => dow !== undefined)

    if (days.length) {
      rule.byday = days
    }
  }

  return rule
}

/** Occurrence days for one event inside [windowStart, windowEnd]. */
function expandOccurrences(start: ParsedStart, rrule: Rrule | null, windowStart: Date, windowEnd: Date): string[] {
  const results: string[] = []
  const first = new Date(start.date.getFullYear(), start.date.getMonth(), start.date.getDate())

  if (!rrule) {
    if (first >= windowStart && first <= windowEnd) {
      results.push(stampOf(first))
    }

    return results
  }

  const push = (day: Date) => {
    if (day >= windowStart && day <= windowEnd && (!rrule.until || day <= rrule.until)) {
      results.push(stampOf(day))
    }
  }

  let produced = 0
  const total = rrule.count ?? Number.POSITIVE_INFINITY
  const hardStop = new Date(windowEnd.getFullYear(), windowEnd.getMonth(), windowEnd.getDate() + 1)

  if (rrule.freq === 'WEEKLY') {
    const days = rrule.byday ?? [first.getDay()]

    // Walk week by week from the first occurrence's week.
    for (let week = 0; produced < total; week++) {
      const base = new Date(first.getFullYear(), first.getMonth(), first.getDate() + week * 7 * rrule.interval)

      if (base > hardStop || results.length >= MAX_OCCURRENCES_PER_EVENT) {
        break
      }

      const weekStart = new Date(base.getFullYear(), base.getMonth(), base.getDate() - base.getDay())

      for (const dow of [...days].sort()) {
        const day = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + dow)

        if (day < first || produced >= total) {
          continue
        }

        produced++
        push(day)
      }
    }

    return results
  }

  const stepDays = rrule.freq === 'DAILY' ? rrule.interval : 0
  const stepMonths = rrule.freq === 'MONTHLY' ? rrule.interval : 0

  if (!stepDays && !stepMonths) {
    // Unsupported FREQ (YEARLY etc.): show the base occurrence only.
    push(first)

    return results
  }

  for (let i = 0; produced < total && results.length < MAX_OCCURRENCES_PER_EVENT; i++) {
    const day = stepDays
      ? new Date(first.getFullYear(), first.getMonth(), first.getDate() + i * stepDays)
      : new Date(first.getFullYear(), first.getMonth() + i * stepMonths, first.getDate())

    if (day > hardStop) {
      break
    }

    produced++
    push(day)
  }

  return results
}

/** TEXT unescaping per RFC 5545 (comma, semicolon, backslash, newline). */
function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, ' ')
    .replace(/\\([,;\\])/g, '$1')
    .trim()
}

export function parseIcs(text: string): IcsEvent[] {
  const windowStart = new Date()

  windowStart.setDate(windowStart.getDate() - WINDOW_BACK_DAYS)

  const windowEnd = new Date()

  windowEnd.setDate(windowEnd.getDate() + WINDOW_AHEAD_DAYS)

  const events: IcsEvent[] = []
  let current: Record<string, { value: string; params: string }> | null = null

  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') {
      current = {}
      continue
    }

    if (line === 'END:VEVENT') {
      if (current?.DTSTART && current.UID) {
        const isUtc = current.DTSTART.value.endsWith('Z')
        const start = parseDtstart(current.DTSTART.value, isUtc)

        if (start) {
          const rrule = current.RRULE ? parseRrule(current.RRULE.value) : null
          const dates = expandOccurrences(start, rrule, windowStart, windowEnd)

          if (dates.length) {
            events.push({
              uid: current.UID.value,
              summary: unescapeText(current.SUMMARY?.value ?? 'Untitled event'),
              location: current.LOCATION ? unescapeText(current.LOCATION.value) : undefined,
              dates,
              time: start.time
            })
          }
        }
      }

      current = null
      continue
    }

    if (!current) {
      continue
    }

    const colon = line.indexOf(':')

    if (colon <= 0) {
      continue
    }

    const head = line.slice(0, colon)
    const semi = head.indexOf(';')
    const name = (semi === -1 ? head : head.slice(0, semi)).toUpperCase()

    if (['DTSTART', 'SUMMARY', 'UID', 'RRULE', 'LOCATION'].includes(name)) {
      current[name] = { value: line.slice(colon + 1).trim(), params: semi === -1 ? '' : head.slice(semi + 1) }
    }
  }

  return events
}

// ---------------------------------------------------------------------------
// Materializing into the vault

function slugOf(text: string): string {
  return (
    text
      .replace(/[/\\:*?"<>|#^[\]]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || 'event'
  )
}

function uidKey(uid: string): string {
  return crypto.createHash('sha1').update(uid).digest('hex').slice(0, 8)
}

function noteContent(event: IcsEvent, date: string, sourceName: string): string {
  const title = event.time ? `${event.time} ${event.summary}` : event.summary
  const lines = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `date: ${date}`,
    ...(event.time ? [`time: "${event.time}"`] : []),
    `source: ${JSON.stringify(sourceName)}`,
    `ics_uid: ${JSON.stringify(event.uid)}`,
    '---',
    `# ${title}`,
    ...(event.location ? ['', `📍 ${event.location}`] : []),
    ''
  ]

  return lines.join('\n')
}

export interface IcsSyncResult {
  events: number
  written: number
  removed: number
  errors: string[]
}

/**
 * Fetch every subscription and reconcile `Calendar/Sync/` with it. Files are
 * only touched when their content actually changed, so a no-op sync causes
 * no watcher churn; files whose event disappeared from the feed are deleted.
 */
export async function syncSubscriptions(service: VaultService): Promise<IcsSyncResult> {
  const result: IcsSyncResult = { events: 0, written: 0, removed: 0, errors: [] }
  const subscriptions = loadSubscriptions()
  const root = service.info().root

  if (!root || !subscriptions.length) {
    return result
  }

  const syncDirAbs = path.join(root, SYNC_DIR)
  const expected = new Map<string, string>() // rel filename -> content

  for (const subscription of subscriptions) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 20_000)
      const response = await fetch(subscription.url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'Daat-Calendar/1.0' }
      })

      clearTimeout(timer)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const events = parseIcs(await response.text())

      subscription.lastSyncAt = Date.now()
      subscription.lastEventCount = events.length
      subscription.lastError = undefined
      result.events += events.length

      let files = 0

      for (const event of events) {
        for (const date of event.dates) {
          if (files >= MAX_FILES_PER_FEED) {
            break
          }

          const name = `${slugOf(event.summary)}--${uidKey(event.uid)}--${date}.md`

          expected.set(name, noteContent(event, date, subscription.name))
          files++
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      subscription.lastError = message
      result.errors.push(`${subscription.name}: ${message}`)
    }
  }

  saveSubscriptions(subscriptions)

  fs.mkdirSync(syncDirAbs, { recursive: true })

  // Write changed/new occurrence notes.
  for (const [name, content] of expected) {
    const abs = path.join(syncDirAbs, name)

    let existing: string | null = null

    try {
      existing = fs.readFileSync(abs, 'utf8')
    } catch {
      existing = null
    }

    if (existing !== content) {
      fs.writeFileSync(abs, content, 'utf8')
      result.written++
    }
  }

  // Remove notes for occurrences that no longer exist — but only files that
  // match our own `--xxxxxxxx--YYYY-MM-DD.md` shape; user files are not ours.
  const OURS_RE = /--[0-9a-f]{8}--\d{4}-\d{2}-\d{2}\.md$/

  for (const name of fs.readdirSync(syncDirAbs)) {
    if (OURS_RE.test(name) && !expected.has(name)) {
      try {
        fs.unlinkSync(path.join(syncDirAbs, name))
        result.removed++
      } catch {
        // Locked/synced file: it will be retried next sync.
      }
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// IPC

export function initIcsIpc(service: VaultService): void {
  ipcMain.handle('hermes:vault:icsSubscriptions', () => loadSubscriptions())

  ipcMain.handle('hermes:vault:icsAdd', async (_event, url: string, name?: string) => {
    const trimmed = String(url ?? '').trim()

    if (!/^https?:\/\//i.test(trimmed)) {
      throw new Error('Not an http(s) URL')
    }

    const subscriptions = loadSubscriptions()

    if (!subscriptions.some(subscription => subscription.url === trimmed)) {
      subscriptions.push({
        id: crypto.randomUUID(),
        name: (name ?? '').trim() || hostLabel(trimmed),
        url: trimmed,
        addedAt: Date.now()
      })
      saveSubscriptions(subscriptions)
    }

    await syncSubscriptions(service)

    return loadSubscriptions()
  })

  ipcMain.handle('hermes:vault:icsRemove', async (_event, id: string) => {
    const remaining = loadSubscriptions().filter(subscription => subscription.id !== id)

    saveSubscriptions(remaining)
    // Reconcile: files of the removed feed vanish on the next pass.
    await syncSubscriptions(service)

    return remaining
  })

  ipcMain.handle('hermes:vault:icsSync', () => syncSubscriptions(service))

  // First sync shortly after boot (vault restore has finished by then),
  // then every 30 minutes. Fully quiet when there are no subscriptions.
  setTimeout(() => void syncSubscriptions(service).catch(() => undefined), 15_000)
  setInterval(() => void syncSubscriptions(service).catch(() => undefined), 30 * 60_000)
}

function hostLabel(url: string): string {
  try {
    const host = new URL(url).hostname

    return host.includes('google') ? 'Google Calendar' : host
  } catch {
    return 'Calendar'
  }
}
