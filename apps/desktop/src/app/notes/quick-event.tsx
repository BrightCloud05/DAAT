/**
 * Quick calendar editing — create and reschedule events without leaving the
 * calendar. Before this, giving a note a date meant a trip through the
 * editor's properties panel (find the strip, guess a key name, hand-type an
 * ISO date); now the calendar itself can do the two things people actually
 * do: "add an event on this day" and "move this to another day".
 *
 * Everything still writes plain markdown — a quick-added event is just a
 * note in `Calendar/` with a `date:` property.
 */

import { useEffect, useRef, useState } from 'react'

import { Codicon } from '@/components/ui/codicon'

import { $vaultRevision } from '../vault/store'
import { type CalendarEntry, DUE_RE } from './calendar'
import { propertyEdit, readFrontmatter } from './frontmatter'
import { $productLocale, productStrings } from './strings'
import { useStore } from '@nanostores/react'

const DATE_KEYS = ['date', 'due', 'when', 'start', 'deadline', 'scheduled']

function vault() {
  return window.hermesDesktop.vault
}

function slugTitle(text: string): string {
  return (
    text
      .replace(/[/\\:*?"<>|#^[\]]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'Event'
  )
}

/**
 * Create `Calendar/<title>.md` carrying the given date. Uses the raw vault
 * bridge on purpose: the store's createNote() adopts the new note into the
 * editor, which would yank the user out of the calendar they are looking at.
 */
export async function createQuickEvent(title: string, date: string): Promise<void> {
  const clean = slugTitle(title)
  let relPath = `Calendar/${clean}.md`
  let result = await vault().createNote(relPath)

  if (!result.created) {
    relPath = `Calendar/${clean} ${date}.md`
    result = await vault().createNote(relPath)

    if (!result.created) {
      // Same title, same day, twice — give it a unique tail and move on.
      relPath = `Calendar/${clean} ${Date.now().toString(36)}.md`
      result = await vault().createNote(relPath)
    }
  }

  const content = `---\ndate: ${date}\n---\n# ${title.trim()}\n`

  await vault().write(relPath, content, result.mtimeMs, result.content)
}

/**
 * Move a calendar entry to another day, in place.
 *
 *   note  — rewrite the date-ish frontmatter property it already uses
 *   task  — rewrite the inline `📅 / due: / @` marker on its line
 *   daily — the date IS the filename; not moved from here
 */
export async function moveEntryToDate(entry: CalendarEntry, date: string): Promise<boolean> {
  if (entry.kind === 'daily') {
    return false
  }

  const file = await vault().read(entry.path)

  if (entry.kind === 'note') {
    const props = readFrontmatter(file.content)?.props ?? {}
    const key = DATE_KEYS.find(candidate => props[candidate] !== undefined) ?? 'date'
    const edit = propertyEdit(file.content, key, date)

    if (!edit) {
      return false
    }

    const next = file.content.slice(0, edit.from) + edit.insert + file.content.slice(edit.to)

    await vault().write(entry.path, next, file.mtimeMs, file.content)

    return true
  }

  // Task: same 1-based line convention as toggleTodo, with the same outward
  // search when the file shifted underneath us.
  const lines = file.content.split('\n')
  const lineIndex = (entry.line ?? 1) - 1
  const hasMarker = (value: string | undefined) => value !== undefined && DUE_RE.test(value)

  let target = hasMarker(lines[lineIndex]) ? lineIndex : -1

  for (let offset = 1; target === -1 && offset < lines.length; offset++) {
    for (const candidate of [lineIndex - offset, lineIndex + offset]) {
      if (candidate >= 0 && candidate < lines.length && hasMarker(lines[candidate]) && lines[candidate].includes(entry.label)) {
        target = candidate
        break
      }
    }
  }

  if (target === -1) {
    return false
  }

  lines[target] = lines[target].replace(DUE_RE, match =>
    match.replace(/\d{4}-\d{2}-\d{2}/, date)
  )

  await vault().write(entry.path, lines.join('\n'), file.mtimeMs, file.content)

  return true
}

/** Inline "add an event on this day" input for the day-detail section. */
export function QuickAddRow({ date }: { date: string }) {
  const s = productStrings(useStore($productLocale))
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const value = title.trim()

    if (!value || busy) {
      return
    }

    setBusy(true)

    try {
      await createQuickEvent(value, date)
      setTitle('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2 border-b border-(--stroke-nous) py-1.5">
      <Codicon className="shrink-0 text-[13px] opacity-45" name="add" />
      <input
        className="w-full min-w-0 bg-transparent text-[13px] outline-none placeholder:opacity-45"
        placeholder={s.quickAddPlaceholder}
        value={title}
        onChange={event => setTitle(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            void submit()
          }
        }}
      />
    </div>
  )
}

/** Hover control that reschedules one entry via a native date picker. */
export function EntryDateButton({ entry }: { entry: CalendarEntry }) {
  const s = productStrings(useStore($productLocale))
  const inputRef = useRef<HTMLInputElement>(null)

  if (entry.kind === 'daily') {
    return null
  }

  return (
    <span className="relative grid size-[20px] shrink-0 place-items-center">
      <button
        className="grid size-[20px] place-items-center rounded-sm opacity-0 transition-opacity hover:bg-(--ui-control-hover-background) group-hover:opacity-60 hover:opacity-100!"
        onClick={() => inputRef.current?.showPicker()}
        title={s.changeDate}
      >
        <Codicon className="text-[12px]" name="calendar" />
      </button>
      {/* Invisible native input: showPicker() anchors the OS date picker here. */}
      <input
        className="pointer-events-none absolute inset-0 opacity-0"
        ref={inputRef}
        tabIndex={-1}
        type="date"
        value={entry.date}
        onChange={event => {
          if (event.target.value) {
            void moveEntryToDate(entry, event.target.value)
          }
        }}
      />
    </span>
  )
}

/** ICS feed manager — list, add, remove, sync now. */
export function SubscriptionsPanel() {
  const s = productStrings(useStore($productLocale))
  const revision = useStore($vaultRevision)
  const [subscriptions, setSubscriptions] = useState<IcsSubscription[]>([])
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void vault()
      .icsSubscriptions()
      .then(setSubscriptions)
      .catch(() => undefined)
  }, [revision])

  const add = async () => {
    const value = url.trim()

    if (!value || busy) {
      return
    }

    setBusy(true)
    setError(null)

    try {
      setSubscriptions(await vault().icsAdd(value))
      setUrl('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const syncNow = async () => {
    setBusy(true)

    try {
      await vault().icsSync()
      setSubscriptions(await vault().icsSubscriptions())
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-md border border-(--stroke-nous) p-3">
      <div className="mb-2 flex items-center gap-2">
        <Codicon className="text-[13px] opacity-60" name="rss" />
        <span className="text-[13px] font-medium">{s.subscriptions}</span>
        <button
          className="ml-auto rounded-md px-2 py-0.5 text-[12px] text-(--dt-primary) transition-opacity hover:opacity-70 disabled:opacity-40"
          disabled={busy || !subscriptions.length}
          onClick={() => void syncNow()}
        >
          {s.syncNow}
        </button>
      </div>

      {subscriptions.map(subscription => (
        <div className="flex items-center gap-2 py-1 text-[12.5px]" key={subscription.id}>
          <span className="truncate">{subscription.name}</span>
          <span className="shrink-0 text-[11px] opacity-45">
            {subscription.lastError ?? s.syncedEvents(subscription.lastEventCount ?? 0)}
          </span>
          <button
            className="ml-auto shrink-0 opacity-45 transition-opacity hover:opacity-100"
            onClick={() => {
              void vault()
                .icsRemove(subscription.id)
                .then(setSubscriptions)
                .catch(() => undefined)
            }}
            title={s.removeSubscription}
          >
            <Codicon className="text-[12px]" name="trash" />
          </button>
        </div>
      ))}

      <div className="mt-1 flex items-center gap-2">
        <input
          className="w-full min-w-0 rounded-md border border-(--stroke-nous) bg-transparent px-2 py-1 text-[12.5px] outline-none placeholder:opacity-40"
          placeholder={s.subscribeUrlPlaceholder}
          value={url}
          onChange={event => setUrl(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              void add()
            }
          }}
        />
        <button
          className="shrink-0 rounded-md px-2 py-1 text-[12.5px] text-(--dt-primary) transition-opacity hover:opacity-70 disabled:opacity-40"
          disabled={busy || !url.trim()}
          onClick={() => void add()}
        >
          {s.addSubscription}
        </button>
      </div>

      {error ? <p className="mt-1 text-[11.5px] text-red-500">{error}</p> : null}
      <p className="mt-2 text-[11.5px] opacity-50">{s.subscriptionHint}</p>
    </div>
  )
}
