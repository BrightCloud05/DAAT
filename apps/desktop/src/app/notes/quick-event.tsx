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

import { useStore } from '@nanostores/react'
import { useEffect, useRef, useState } from 'react'

import { Codicon } from '@/components/ui/codicon'

import { $vaultRevision } from '../vault/store'

import { type CalendarEntry, dateFromValue, DUE_RE, taskLabel } from './calendar'
import { propertyEdit, readFrontmatter } from './frontmatter'
import { $productLocale, productStrings } from './strings'

const DATE_KEYS = ['date', 'due', 'when', 'start', 'deadline', 'scheduled']

function vault() {
  return window.hermesDesktop.vault
}

function requireWrite(result: VaultWriteResult): void {
  if (result.ok) {return}

  const s = productStrings($productLocale.get())

  throw new Error(result.reason === 'conflict' ? `${s.conflictNotice} (${result.conflictPath})` : s.calendarSaveFailed)
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
  const root = (await vault().info()).root ?? undefined
  let relPath = `Calendar/${clean}.md`
  let result = await vault().createNote(relPath, root)

  if (!result.created) {
    relPath = `Calendar/${clean} ${date}.md`
    result = await vault().createNote(relPath, root)

    if (!result.created) {
      // Same title, same day, twice — give it a unique tail and move on.
      relPath = `Calendar/${clean} ${crypto.randomUUID()}.md`
      result = await vault().createNote(relPath, root)
    }
  }

  const content = `---\ndate: ${date}\n---\n# ${title.trim()}\n`

  if (!result.created) {throw new Error(productStrings($productLocale.get()).calendarEntryChanged)}

  requireWrite(await vault().write(relPath, content, result.mtimeMs, result.content, root))
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
  const root = file.vaultRoot

  if (entry.kind === 'note') {
    const props = readFrontmatter(file.content)?.props ?? {}
    const key = DATE_KEYS.find(candidate => dateFromValue(props[candidate]) === entry.date)

    if (!key) {return false}
    const edit = propertyEdit(file.content, key, date)

    if (!edit) {
      return false
    }

    const next = file.content.slice(0, edit.from) + edit.insert + file.content.slice(edit.to)

    requireWrite(await vault().write(entry.path, next, file.mtimeMs, file.content, root))

    return true
  }

  // A row number is a hint, never an identity. Another editor can insert a
  // different dated task there. Only a unique text + original-date match is
  // safe; duplicate tasks need a refresh instead of a guess.
  const lines = file.content.split('\n')

  const candidates = lines.flatMap((line, index) => {
    const task = /^\s*[-*+]\s+\[[ xX]\]\s+(.*)$/.exec(line)?.[1]

    return task && DUE_RE.exec(task)?.[1] === entry.date && taskLabel(task) === entry.label ? [index] : []
  })

  if (candidates.length !== 1) {return false}

  const target = candidates[0]

  lines[target] = lines[target].replace(DUE_RE, match => match.replace(/\d{4}-\d{2}-\d{2}/, date))

  requireWrite(await vault().write(entry.path, lines.join('\n'), file.mtimeMs, file.content, root))

  return true
}

/** Inline "add an event on this day" input for the day-detail section. */
export function QuickAddRow({ date }: { date: string }) {
  const s = productStrings(useStore($productLocale))
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const value = title.trim()

    if (!value || busy) {
      return
    }

    setBusy(true)
    setError(null)

    try {
      await createQuickEvent(value, date)
      setTitle('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : s.calendarSaveFailed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-(--stroke-nous) py-1.5">
      <Codicon className="shrink-0 text-[13px] opacity-45" name="add" />
      <input
        aria-label={s.quickAddPlaceholder}
        className="w-full min-w-0 bg-transparent text-[13px] outline-none placeholder:opacity-45"
        disabled={busy}
        onChange={event => setTitle(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            void submit()
          }
        }}
        placeholder={s.quickAddPlaceholder}
        value={title}
      />
      {error ? (
        <p className="w-full text-xs text-(--dt-destructive)" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** Hover control that reschedules one entry via a native date picker. */
export function EntryDateButton({ entry }: { entry: CalendarEntry }) {
  const s = productStrings(useStore($productLocale))
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  if (entry.kind === 'daily') {
    return null
  }

  return (
    <span className="relative grid size-[20px] shrink-0 place-items-center">
      <button
        aria-label={s.changeDate}
        className="grid size-[20px] place-items-center rounded-sm opacity-0 transition-opacity hover:bg-(--ui-control-hover-background) group-hover:opacity-60 focus-visible:opacity-100 hover:opacity-100!"
        onClick={() => inputRef.current?.showPicker()}
        title={s.changeDate}
      >
        <Codicon className="text-[12px]" name="calendar" />
      </button>
      {/* Invisible native input: showPicker() anchors the OS date picker here. */}
      <input
        aria-label={s.calendarDateLabel}
        className="pointer-events-none absolute inset-0 opacity-0"
        onChange={event => {
          if (event.target.value) {
            setError(null)
            void moveEntryToDate(entry, event.target.value)
              .then(changed => {
                if (!changed) {setError(s.calendarEntryChanged)}
              })
              .catch(cause => setError(cause instanceof Error ? cause.message : s.calendarSaveFailed))
          }
        }}
        ref={inputRef}
        tabIndex={-1}
        type="date"
        value={entry.date}
      />
      {error ? (
        <span
          className="absolute right-0 top-full z-10 w-64 rounded-md bg-(--ui-bg-editor) p-2 text-xs text-(--dt-destructive) shadow"
          role="alert"
        >
          {error}
        </span>
      ) : null}
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
      .catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))
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
    setError(null)

    try {
      const result = await vault().icsSync()
      setSubscriptions(await vault().icsSubscriptions())

      if (result.errors.length) {setError(result.errors.join('\n'))}
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
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
                .catch(async cause => {
                  setError(cause instanceof Error ? cause.message : String(cause))
                  await vault()
                    .icsSubscriptions()
                    .then(setSubscriptions)
                    .catch(() => undefined)
                })
            }}
            title={s.removeSubscription}
          >
            <Codicon className="text-[12px]" name="trash" />
          </button>
        </div>
      ))}

      <div className="mt-1 flex items-center gap-2">
        <input
          aria-label={s.subscribeUrlPlaceholder}
          className="w-full min-w-0 rounded-md border border-(--stroke-nous) bg-transparent px-2 py-1 text-[12.5px] outline-none placeholder:opacity-40"
          onChange={event => setUrl(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              void add()
            }
          }}
          placeholder={s.subscribeUrlPlaceholder}
          value={url}
        />
        <button
          className="shrink-0 rounded-md px-2 py-1 text-[12.5px] text-(--dt-primary) transition-opacity hover:opacity-70 disabled:opacity-40"
          disabled={busy || !url.trim()}
          onClick={() => void add()}
        >
          {s.addSubscription}
        </button>
      </div>

      {error ? (
        <p className="mt-1 text-[11.5px] text-red-500" role="alert">
          {error}
        </p>
      ) : null}
      <p className="mt-2 text-[11.5px] opacity-50">{s.subscriptionHint}</p>
    </div>
  )
}
