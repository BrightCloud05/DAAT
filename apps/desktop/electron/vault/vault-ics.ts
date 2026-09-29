import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/** Calendar feeds become ordinary notes. Failed refreshes never revoke known events. */
import { app, ipcMain } from 'electron'
import ICAL from 'ical.js'

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
  dates: string[]
  time?: string
  /** Original recurrence identity survives a moved exception. */
  occurrence: string
}
interface ManagedNote {
  subscription: string
  identity: string
  content: string
}
interface SyncManifest {
  notes: Record<string, ManagedNote>
}
export interface IcsSyncResult {
  events: number
  written: number
  removed: number
  errors: string[]
}
const SYNC_DIR = 'Calendar/Sync'
const MAX_FILES_PER_FEED = 800
const MAX_EXPANSION_STEPS = 100_000

const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 20)
const stateFile = () => path.join(app.getPath('userData'), 'calendar-subscriptions.json')
const manifestFile = (root: string) => path.join(app.getPath('userData'), `calendar-sync-${hash(root)}.json`)

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {return null}
    throw error
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${crypto.randomUUID()}.tmp`

  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 })
    fs.renameSync(temporary, file)
  } finally {
    if (fs.existsSync(temporary)) {fs.unlinkSync(temporary)}
  }
}

export function loadSubscriptions(): IcsSubscription[] {
  const parsed = readJson(stateFile()) as { subscriptions?: IcsSubscription[] } | null

  if (!parsed) {return []}

  if (
    !Array.isArray(parsed.subscriptions) ||
    parsed.subscriptions.some(
      item => !item || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.url !== 'string'
    )
  ) {
    throw new Error('The calendar subscription settings could not be read.')
  }

  return parsed.subscriptions
}

function saveSubscriptions(subscriptions: IcsSubscription[]): void {
  writeJson(stateFile(), { subscriptions })
}

/** IANA feeds commonly omit VTIMEZONE. Use the host's zone database for those
 * IDs, while honoring explicit feed definitions and keeping caches feed-local. */
function installTimezones(calendar: InstanceType<typeof ICAL.Component>): void {
  const original = calendar.getTimeZoneByID.bind(calendar)
  const zones = new Map<string, InstanceType<typeof ICAL.Timezone>>()

  calendar.getTimeZoneByID = id => {
    const defined = original(id)

    if (defined) {return defined}
    const cached = zones.get(id)

    if (cached) {return cached}

    const format = new Intl.DateTimeFormat('en-CA', {
      timeZone: id,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    })

    const wallAt = (instant: number) => {
      const parts = Object.fromEntries(format.formatToParts(instant).map(part => [part.type, part.value]))

      return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
    }

    const zone = new ICAL.Timezone({ tzid: id })

    zone.utcOffset = time => {
      const wall = Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second)
      const before = (wallAt(wall - 36 * 3600_000) - (wall - 36 * 3600_000)) / 1000
      const after = (wallAt(wall + 36 * 3600_000) - (wall + 36 * 3600_000)) / 1000
      const candidates = [...new Set([before, after])].filter(offset => wallAt(wall - offset * 1000) === wall)

      // RFC 5545: first occurrence of an ambiguous time; pre-gap offset for a
      // nonexistent wall clock. Neither case silently changes the event's zone.
      return candidates.length ? Math.max(...candidates) : before
    }

    zones.set(id, zone)

    return zone
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function stamp(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function parseIcs(text: string, now = new Date()): IcsEvent[] {
  if (!/^BEGIN:VCALENDAR\s*$/im.test(text) || !/^END:VCALENDAR\s*$/im.test(text))
    {throw new Error('The response is not an iCalendar feed.')}

  const calendar = new ICAL.Component(ICAL.parse(text))

  if (calendar.name !== 'vcalendar') {throw new Error('The response is not an iCalendar feed.')}
  installTimezones(calendar)
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7)
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 91)
  const items = calendar.getAllSubcomponents('vevent').map(component => new ICAL.Event(component))
  const result: IcsEvent[] = []
  const emitted = new Set<string>()

  const canceledSeries = new Set(
    items
      .filter(item => !item.isRecurrenceException() && item.component.getFirstPropertyValue('status') === 'CANCELLED')
      .map(item => item.uid)
  )

  const add = (
    item: InstanceType<typeof ICAL.Event>,
    date: InstanceType<typeof ICAL.Time> | undefined,
    identity: string
  ) => {
    if (!date || canceledSeries.has(item.uid) || item.component.getFirstPropertyValue('status') === 'CANCELLED') {return}
    const local = date.toJSDate()

    if (local < start || local >= end) {return}
    const key = `${item.uid}\0${identity}`

    if (emitted.has(key)) {return}
    emitted.add(key)

    if (result.length >= MAX_FILES_PER_FEED)
      {throw new Error('This feed exceeds the 800-event sync window; existing notes were kept.')}

    result.push({
      uid: item.uid,
      occurrence: identity,
      summary: (item.summary || 'Untitled event').replace(/\n/g, ' '),
      location: item.location?.replace(/\n/g, ' '),
      dates: [stamp(local)],
      time: date.isDate ? undefined : `${pad(local.getHours())}:${pad(local.getMinutes())}`
    })
  }

  for (const item of items) {
    if (
      !item.uid ||
      !item.startDate ||
      item.isRecurrenceException() ||
      item.component.getFirstPropertyValue('status') === 'CANCELLED'
    )
      {continue}

    if (!item.isRecurring()) {
      add(item, item.startDate, item.startDate.toString())

      continue
    }

    const iterator = item.iterator()
    let exhausted = false

    for (let steps = 0; steps < MAX_EXPANSION_STEPS; steps++) {
      const occurrence = iterator.next()

      if (!occurrence || occurrence.toJSDate() >= end) {
        exhausted = true

        break
      }

      const exception =
        item.exceptions[occurrence.toString() as unknown as number] ??
        item.exceptions[occurrence.convertToZone(ICAL.Timezone.utcTimezone).toString() as unknown as number]

      if (exception?.component.getFirstPropertyValue('status') === 'CANCELLED') {continue}
      const details = item.getOccurrenceDetails(occurrence)
      add(details.item, details.startDate, occurrence.toString())
    }

    if (!exhausted) {throw new Error('This recurrence is too large to expand safely; existing notes were kept.')}
  }

  // A detached exception can move into the window from an original date
  // outside it. Its RECURRENCE-ID, rather than the new date, owns the note.
  for (const item of items) {if (item.isRecurrenceException()) {add(item, item.startDate, item.recurrenceId.toString())}}

  return result
}

function noteContent(event: IcsEvent, subscription: IcsSubscription): string {
  const title = event.time ? `${event.time} ${event.summary}` : event.summary

  return [
    '---',
    `title: ${JSON.stringify(title)}`,
    `date: ${event.dates[0]}`,
    ...(event.time ? [`time: ${JSON.stringify(event.time)}`] : []),
    `source: ${JSON.stringify(subscription.name)}`,
    `ics_uid: ${JSON.stringify(event.uid)}`,
    `ics_subscription: ${JSON.stringify(hash(subscription.url))}`,
    '---',
    `# ${title}`,
    ...(event.location ? ['', `📍 ${event.location}`] : []),
    '\n'
  ].join('\n')
}

/** Recognize the exact legacy generator prefix, never just its filename shape.
 * Appended user prose remains outside the owned prefix during migration. */
async function adoptLegacyNotes(
  service: VaultService,
  root: string,
  manifest: SyncManifest,
  subscriptions: IcsSubscription[]
): Promise<void> {
  const legacyPattern =
    /^---\n(title: ("(?:[^"\\]|\\.)*")\ndate: (\d{4}-\d{2}-\d{2})\n(?:time: "(\d{2}:\d{2})"\n)?source: ("(?:[^"\\]|\\.)*")\nics_uid: ("(?:[^"\\]|\\.)*")\n)---\n# ([^\n]*)\n(?:\n📍 [^\n]*\n)?/

  for (const note of service.list()) {
    if (
      !note.path.startsWith(`${SYNC_DIR}/`) ||
      !/--[a-f0-9]{8}--\d{4}-\d{2}-\d{2}\.md$/.test(note.path) ||
      manifest.notes[note.path]
    )
      {continue}

    const file = await service.read(note.path, root)

    if (file.dataless) {continue}
    const matched = legacyPattern.exec(file.content)

    if (!matched || JSON.parse(matched[2]) !== matched[7]) {continue}
    const source = JSON.parse(matched[5]) as string
    const owners = subscriptions.filter(subscription => subscription.name === source)

    if (owners.length !== 1) {continue}
    const uid = JSON.parse(matched[6]) as string
    const uidHash = crypto.createHash('sha1').update(uid).digest('hex').slice(0, 8)

    if (!note.path.endsWith(`--${uidHash}--${matched[3]}.md`)) {continue}
    manifest.notes[note.path] = {
      subscription: owners[0].id,
      identity: `${uid}\0legacy:${matched[3]}`,
      content: matched[0]
    }
  }
}

const queues = new WeakMap<VaultService, Promise<unknown>>()

/** A single service cannot reconcile two generations concurrently. */
export function syncSubscriptions(service: VaultService, retired: IcsSubscription[] = []): Promise<IcsSyncResult> {
  const root = service.info().root

  const queued = (queues.get(service) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => reconcile(service, root, retired))

  queues.set(service, queued)

  return queued
}

async function reconcile(
  service: VaultService,
  root: string | null,
  retired: IcsSubscription[]
): Promise<IcsSyncResult> {
  const result: IcsSyncResult = { events: 0, written: 0, removed: 0, errors: [] }

  if (!root) {return result}

  if (service.info().root !== root) {throw new Error('The notes folder changed. Refresh the calendar again.')}
  const subscriptions = loadSubscriptions()
  const manifest = (readJson(manifestFile(root)) ?? { notes: {} }) as SyncManifest

  if (!manifest.notes || typeof manifest.notes !== 'object')
    {throw new Error('The calendar sync record could not be read.')}

  await adoptLegacyNotes(service, root, manifest, [...subscriptions, ...retired])
  const successful = new Set<string>()
  const expected = new Set<string>()

  for (const subscription of subscriptions) {
    let timer: ReturnType<typeof setTimeout> | undefined

    try {
      const controller = new AbortController()
      timer = setTimeout(() => controller.abort(), 20_000)

      const response = await fetch(subscription.url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'Daat-Calendar/1.0' }
      })

      if (!response.ok) {throw new Error(`HTTP ${response.status}`)}
      const text = await response.text()

      if (text.length > 5_000_000) {throw new Error('The calendar feed is too large.')}
      const events = parseIcs(text)

      // Removal/addition during an in-flight fetch is authoritative.
      if (!loadSubscriptions().some(current => current.id === subscription.id)) {continue}
      const errorsBeforeWrites = result.errors.length
      successful.add(subscription.id)
      result.events += events.length

      for (const event of events) {
        const identity = `${event.uid}\0${event.occurrence}`

        const known = Object.entries(manifest.notes).find(
          ([, note]) =>
            note.subscription === subscription.id &&
            (note.identity === identity ||
              note.identity === `${event.uid}\0legacy:${event.dates[0]}` ||
              note.identity === `${event.uid}\0legacy:${event.occurrence.slice(0, 10)}`)
        )

        const relPath = known?.[0] ?? `${SYNC_DIR}/${hash(subscription.url)}/${hash(identity)}.md`
        expected.add(relPath)
        const content = noteContent(event, subscription)

        try {
          let file

          if (known) {
            try {
              file = await service.read(relPath, root)
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {throw error}
            }
          }

          if (!file) {
            const created = await service.createNote(relPath, root)

            if (!created.created && !created.content.startsWith(content))
              {throw new Error('An existing note occupies this event path.')}

            file = created
          }

          if (!known) {manifest.notes[relPath] = { subscription: subscription.id, identity, content: file.content }}
          const old = known?.[1].content

          if (file.dataless) {throw new Error('The note is still downloading.')}

          if (old && !file.content.startsWith(old))
            {throw new Error('This event note was edited. Its contents were kept; review it before syncing changes.')}

          const next =
            content +
            (old
              ? file.content.slice(old.length)
              : file.content.startsWith(content)
                ? file.content.slice(content.length)
                : '')

          if (file.content !== next) {
            const saved = await service.write(relPath, next, file.mtimeMs, file.content, root)

            if (saved.ok === false)
              {throw new Error(
                saved.reason === 'conflict'
                  ? `The note changed; a conflict copy was saved at ${saved.conflictPath}.`
                  : 'The note is still downloading.'
              )}

            result.written++
          }

          manifest.notes[relPath] = { subscription: subscription.id, identity, content }
        } catch (error) {
          result.errors.push(
            `${subscription.name}: ${relPath}: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }

      subscription.lastSyncAt = Date.now()
      subscription.lastEventCount = events.length
      subscription.lastError = result.errors.slice(errorsBeforeWrites).join('\n') || undefined
    } catch (error) {
      subscription.lastError = error instanceof Error ? error.message : String(error)
      result.errors.push(`${subscription.name}: ${subscription.lastError}`)
    } finally {
      if (timer) {clearTimeout(timer)}
    }
  }

  // No deletion on a failed feed. Explicitly removed feeds are reconciled even
  // when the final subscription has gone, and only recorded owned files qualify.
  const latest = loadSubscriptions()
  const latestIds = new Set(latest.map(subscription => subscription.id))

  for (const [relPath, managed] of Object.entries(manifest.notes)) {
    const removedFeed = !latestIds.has(managed.subscription)

    if (!removedFeed && (!successful.has(managed.subscription) || expected.has(relPath))) {continue}

    try {
      const file = await service.read(relPath, root)

      if (file.dataless) {throw new Error('The note is still downloading.')}

      if (file.content === managed.content) {
        await service.trash(relPath, root)
        result.removed++
      } else {result.errors.push(`${relPath}: the event was removed, but your edited note was kept.`)}

      delete manifest.notes[relPath]
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {delete manifest.notes[relPath]}
      else {result.errors.push(`${relPath}: ${error instanceof Error ? error.message : String(error)}`)}
    }
  }

  writeJson(manifestFile(root), manifest)
  // Merge status into the latest settings so an older fetch cannot resurrect a
  // deleted subscription or erase one added while it was pending.
  saveSubscriptions(
    latest.map(current => {
      const completed = subscriptions.find(subscription => subscription.id === current.id)

      return completed
        ? {
            ...current,
            lastSyncAt: completed.lastSyncAt,
            lastEventCount: completed.lastEventCount,
            lastError: completed.lastError
          }
        : current
    })
  )

  return result
}

export function initIcsIpc(service: VaultService): void {
  ipcMain.handle('hermes:vault:icsSubscriptions', () => loadSubscriptions())
  ipcMain.handle('hermes:vault:icsAdd', async (_event, url: string, name?: string) => {
    const trimmed = String(url ?? '').trim()

    if (!/^https?:\/\//i.test(trimmed)) {throw new Error('Not an http(s) URL')}
    const subscriptions = loadSubscriptions()

    if (!subscriptions.some(subscription => subscription.url === trimmed)) {
      subscriptions.push({
        id: crypto.randomUUID(),
        name: (name ?? '').trim() || new URL(trimmed).hostname,
        url: trimmed,
        addedAt: Date.now()
      })
      saveSubscriptions(subscriptions)
    }

    await syncSubscriptions(service)

    return loadSubscriptions()
  })
  ipcMain.handle('hermes:vault:icsRemove', async (_event, id: string) => {
    const before = loadSubscriptions()
    saveSubscriptions(before.filter(subscription => subscription.id !== id))
    await syncSubscriptions(
      service,
      before.filter(subscription => subscription.id === id)
    )

    return loadSubscriptions()
  })
  ipcMain.handle('hermes:vault:icsSync', () => syncSubscriptions(service))
  setTimeout(() => void syncSubscriptions(service).catch(() => undefined), 15_000)
  setInterval(() => void syncSubscriptions(service).catch(() => undefined), 30 * 60_000)
}
