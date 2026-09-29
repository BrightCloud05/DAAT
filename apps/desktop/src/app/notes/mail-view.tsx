/** The account owns its inbox state; a message ID alone is never an identity. */
import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

import { moveMail, nextAfter } from './mail-actions'
import { htmlMailToText } from './mail-html'
import { $productLocale, productStrings } from './strings'

const LIST_LIMIT = 40
interface MailState {
  installed: boolean
  accounts: Array<{ name: string; default: boolean }>
}
interface MailViewProps {
  onAskAgent?: (prompt: string) => void
}

function splitMessage(raw: string): string {
  const [head, ...rest] = raw.split('\n\n')

  // A plain message body need not have a header block.
  return rest.length && /^(From|To|Cc|Subject|Date):/im.test(head) ? rest.join('\n\n') : raw
}

export function MailView({ onAskAgent }: MailViewProps) {
  const s = productStrings(useStore($productLocale))
  const [state, setState] = useState<MailState | null>(null)
  const [account, setAccount] = useState<string | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let alive = true
    setError(null)
    void window.hermesDesktop.mail
      .status()
      .then(status => {
        if (!alive) {
          return
        }

        setState(status)
        setAccount(current =>
          status.accounts.some(entry => entry.name === current)
            ? current
            : (status.accounts.find(entry => entry.default)?.name ?? status.accounts[0]?.name)
        )
      })
      .catch(cause => {
        if (alive) {
          setError(cause instanceof Error ? cause.message : s.mailUnavailable)
        }
      })

    return () => {
      alive = false
    }
  }, [refresh, s.mailUnavailable])

  return (
    <div className="flex h-full min-h-0 flex-col">
      {error ? (
        <div className="p-4 text-sm" role="alert">
          {s.mailUnavailable} {error}{' '}
          <button className="underline" onClick={() => setRefresh(value => value + 1)}>
            {s.retryNow}
          </button>
        </div>
      ) : null}
      {!state ? (
        !error ? (
          <div className="p-6 text-sm" role="status">
            {s.loading}
          </div>
        ) : null
      ) : !state.installed || !state.accounts.length ? (
        <div className="m-auto max-w-lg space-y-3 p-6 text-center">
          <Codicon className="text-3xl opacity-50" name="mail" />
          <h1 className="text-lg font-semibold">{s.noMailAccount}</h1>
          <p className="text-sm opacity-65">{s.mailSetupHint}</p>
          <button
            className="rounded-md border border-(--stroke-nous) px-3 py-1"
            onClick={() => setRefresh(value => value + 1)}
          >
            {s.retryNow}
          </button>
        </div>
      ) : account ? (
        <>
          {state.accounts.length > 1 ? (
            <label className="flex items-center gap-2 border-b border-(--stroke-nous) px-4 py-2 text-xs">
              {s.mailAccount}
              <select
                aria-label={s.mailAccount}
                className="rounded-md bg-(--ui-control-hover-background) p-1"
                onChange={event => setAccount(event.target.value)}
                value={account}
              >
                {state.accounts.map(entry => (
                  <option key={entry.name} value={entry.name}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <MailInbox account={account} key={account} onAskAgent={onAskAgent} />
        </>
      ) : null}
    </div>
  )
}

function MailInbox({ account, onAskAgent }: MailViewProps & { account: string }) {
  const s = productStrings(useStore($productLocale))
  const [envelopes, setEnvelopes] = useState<MailEnvelope[]>([])
  const [selected, setSelected] = useState<MailEnvelope | null>(null)
  const [body, setBody] = useState('')
  const [reading, setReading] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const [readRevision, setReadRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [folders, setFolders] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const requests = useRef({ active: true, generation: 0 })
  const busyRef = useRef(false)
  const envelopesRef = useRef(envelopes)
  envelopesRef.current = envelopes

  const load = useCallback(
    async (text: string) => {
      const request = ++requests.current.generation
      setLoading(true)
      setError(null)
      setSelected(null)

      try {
        const rows = text.trim()
          ? await window.hermesDesktop.mail.search({ query: text.trim(), account, folder: 'INBOX', limit: LIST_LIMIT })
          : await window.hermesDesktop.mail.list({ account, folder: 'INBOX', limit: LIST_LIMIT })

        if (!requests.current.active || request !== requests.current.generation) {
          return
        }

        setEnvelopes(rows)
      } catch (cause) {
        if (requests.current.active && request === requests.current.generation) {
          setError(cause instanceof Error ? cause.message : s.mailLoadFailed)
        }
      } finally {
        if (requests.current.active && request === requests.current.generation) {
          setLoading(false)
        }
      }
    },
    [account, s.mailLoadFailed]
  )

  useEffect(() => {
    const lifetime = requests.current
    lifetime.active = true
    void load('')
    void window.hermesDesktop.mail
      .folders({ account })
      .then(rows => {
        if (lifetime.active) {
          setFolders(rows)
        }
      })
      .catch(cause => {
        if (lifetime.active) {
          setError(cause instanceof Error ? cause.message : s.mailLoadFailed)
        }
      })

    return () => {
      lifetime.active = false
      ++lifetime.generation
    }
  }, [account, load, s.mailLoadFailed])

  useEffect(() => {
    let current = true
    setBody('')
    setReadError(null)

    if (!selected) {
      setReading(false)

      return
    }

    setReading(true)
    void window.hermesDesktop.mail
      .read({ id: selected.id, account, folder: 'INBOX' })
      .then(text => {
        if (current) {
          setBody(text)
        }
      })
      .catch(cause => {
        if (current) {
          setReadError(cause instanceof Error ? cause.message : s.mailReadFailed)
        }
      })
      .finally(() => {
        if (current) {
          setReading(false)
        }
      })

    return () => {
      current = false
    }
  }, [selected, account, readRevision, s.mailReadFailed])

  const triage = useCallback(
    async (envelope: MailEnvelope, run: () => Promise<unknown>) => {
      if (busyRef.current || loading || !envelopesRef.current.some(row => row.id === envelope.id)) {
        return
      }

      busyRef.current = true
      setBusy(true)
      setError(null)
      const before = envelopesRef.current
      const request = requests.current.generation
      setSelected(nextAfter(before, envelope.id))
      setEnvelopes(before.filter(row => row.id !== envelope.id))

      try {
        await run()
      } catch (cause) {
        if (requests.current.active && request === requests.current.generation) {
          setEnvelopes(before)
          setSelected(envelope)
          setError(cause instanceof Error ? cause.message : s.mailLoadFailed)
        }
      } finally {
        busyRef.current = false

        if (requests.current.active) {
          setBusy(false)
        }
      }
    },
    [loading, s.mailLoadFailed]
  )

  const moveTo = useCallback(
    (envelope: MailEnvelope, kind: 'archive' | 'trash') => {
      void triage(envelope, () =>
        moveMail(
          options => window.hermesDesktop.mail.move(options),
          { id: envelope.id, account, folder: 'INBOX' },
          kind,
          folders
        )
      )
    },
    [account, folders, triage]
  )

  const markSeen = useCallback(
    (envelope: MailEnvelope) => {
      void triage(envelope, () =>
        window.hermesDesktop.mail.flag({
          id: envelope.id,
          flag: 'Seen',
          remove: envelope.seen,
          account,
          folder: 'INBOX'
        })
      )
    },
    [account, triage]
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null

      if (
        !selected ||
        busyRef.current ||
        loading ||
        event.isComposing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return
      }

      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) {
        return
      }

      if (event.key === 'e') {
        event.preventDefault()
        moveTo(selected, 'archive')
      }

      if (event.key === '#') {
        event.preventDefault()
        moveTo(selected, 'trash')
      }

      if (event.key === 'u') {
        event.preventDefault()
        markSeen(selected)
      }
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [selected, loading, moveTo, markSeen])

  const message = useMemo(() => htmlMailToText(splitMessage(body)), [body])

  const ask = (intent: 'summary' | 'reply' | 'note') => {
    if (!selected) {
      return
    }

    const identity = `email message_id ${JSON.stringify(selected.id)} in folder "INBOX" of account ${JSON.stringify(account)}`
    const read = `Read ${identity} with mail_read, passing account ${JSON.stringify(account)} explicitly. `
    onAskAgent?.(
      read +
        (intent === 'summary'
          ? 'Summarize it in three bullets and say whether it needs a reply.'
          : intent === 'note'
            ? 'Save the key points as a note in my vault with vault_write, including its source account and message.'
            : `Draft a polite reply using mail_reply with message_id ${JSON.stringify(selected.id)}, folder "INBOX", account ${JSON.stringify(account)}. Do not send it; leave it in Drafts for review.`)
    )
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-[22rem] max-w-[45%] shrink-0 flex-col border-r border-(--stroke-nous)">
        <div className="flex flex-wrap items-center gap-2 px-4 pb-2 pt-5">
          <h1 className="text-xl font-bold">{s.inbox}</h1>
          <span className="text-xs opacity-50">{s.mailRecentUnread(envelopes.filter(row => !row.seen).length)}</span>
          <button className="ml-auto text-xs underline" disabled={busy} onClick={() => void load(query)}>
            {s.refresh}
          </button>
        </div>
        <form
          className="px-4 pb-2"
          onSubmit={event => {
            event.preventDefault()

            if (!busy) {
              void load(query)
            }
          }}
        >
          <input
            aria-label={s.search}
            className="w-full rounded-md bg-(--ui-control-hover-background) px-2 py-1 text-sm"
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && event.nativeEvent.isComposing) {
                event.preventDefault()
              }
            }}
            placeholder={s.mailSearchPlaceholder}
            value={query}
          />
        </form>
        {error ? (
          <div className="px-4 pb-2 text-xs text-(--dt-destructive)" role="alert">
            {error}{' '}
            <button className="underline" onClick={() => void load(query)}>
              {s.retryNow}
            </button>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading ? (
            <p className="p-2 text-sm opacity-50" role="status">
              {s.loading}
            </p>
          ) : (
            envelopes.map(envelope => (
              <button
                aria-pressed={selected?.id === envelope.id}
                className={cn(
                  'flex w-full flex-col gap-1 rounded-md px-2 py-2 text-left hover:bg-(--ui-control-hover-background)',
                  selected?.id === envelope.id && 'bg-(--ui-control-active-background)'
                )}
                key={envelope.id}
                onClick={() => setSelected(envelope)}
              >
                <span className={cn('truncate text-sm', !envelope.seen && 'font-semibold')}>{envelope.fromName}</span>
                <span className="truncate text-xs opacity-75">{envelope.subject || s.noSubject}</span>
                <span className="text-xs opacity-45">{envelope.date.slice(0, 16)}</span>
              </button>
            ))
          )}
          {!loading && !envelopes.length && !error ? <p className="p-2 text-sm opacity-50">{s.inboxEmpty}</p> : null}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <>
            <div className="border-b border-(--stroke-nous) px-5 py-5">
              <h2 className="text-lg font-semibold">{selected.subject || s.noSubject}</h2>
              <p className="mt-1 break-all text-xs opacity-65">
                {selected.fromName} {selected.fromAddr ? `<${selected.fromAddr}>` : ''} · {selected.date.slice(0, 16)}
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <button
                  className="rounded-md border border-(--stroke-nous) px-2 py-1"
                  disabled={busy}
                  onClick={() => moveTo(selected, 'archive')}
                >
                  {s.mailArchive}
                </button>
                <button
                  className="rounded-md border border-(--stroke-nous) px-2 py-1"
                  disabled={busy}
                  onClick={() => moveTo(selected, 'trash')}
                >
                  {s.mailTrash}
                </button>
                <button
                  className="rounded-md border border-(--stroke-nous) px-2 py-1"
                  disabled={busy}
                  onClick={() => markSeen(selected)}
                >
                  {selected.seen ? s.mailMarkUnread : s.mailMarkRead}
                </button>
                {onAskAgent ? (
                  <>
                    <button
                      className="rounded-md border border-(--stroke-nous) px-2 py-1"
                      onClick={() => ask('summary')}
                    >
                      ✦ {s.mailSummarize}
                    </button>
                    <button className="rounded-md border border-(--stroke-nous) px-2 py-1" onClick={() => ask('reply')}>
                      ✦ {s.mailDraftReply}
                    </button>
                    <button className="rounded-md border border-(--stroke-nous) px-2 py-1" onClick={() => ask('note')}>
                      ✦ {s.mailSaveToNotes}
                    </button>
                  </>
                ) : null}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {reading ? (
                <p role="status">{s.loading}</p>
              ) : readError ? (
                <p role="alert">
                  {s.mailReadFailed} {readError}{' '}
                  <button className="underline" onClick={() => setReadRevision(value => value + 1)}>
                    {s.retryNow}
                  </button>
                </p>
              ) : (
                <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{message}</pre>
              )}
            </div>
          </>
        ) : (
          <div className="m-auto p-6 text-sm opacity-55">{s.mailSelectMessage}</div>
        )}
      </div>
    </div>
  )
}
