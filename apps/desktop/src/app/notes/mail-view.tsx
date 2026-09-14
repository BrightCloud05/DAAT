/**
 * Mail screen — the inbox as a working surface: envelope list on the left,
 * message on the right, and every AI action handed to the agent (which keeps
 * the approval gate for anything that leaves the machine).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

import { archiveFolder, nextAfter, TRASH_ALIAS, trashFolder } from './mail-actions'
import { htmlMailToText } from './mail-html'

const LIST_LIMIT = 40

interface MailState {
  installed: boolean
  accounts: Array<{ name: string; default: boolean }>
}

function relativeDate(raw: string): string {
  const parsed = Date.parse(raw)

  if (!Number.isFinite(parsed)) {
    return raw.slice(0, 16)
  }

  const minutes = Math.max(0, Math.round((Date.now() - parsed) / 60_000))

  if (minutes < 60) {return `${minutes}m`}

  if (minutes < 60 * 24) {return `${Math.round(minutes / 60)}h`}

  if (minutes < 60 * 24 * 7) {return `${Math.round(minutes / (60 * 24))}d`}

  return new Date(parsed).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** Strip the header block himalaya prepends so the body reads cleanly. */
function splitMessage(raw: string): { headers: string[]; body: string } {
  const [head, ...rest] = raw.split('\n\n')

  if (!rest.length) {
    return { headers: [], body: raw }
  }

  return { headers: head.split('\n').filter(Boolean), body: rest.join('\n\n') }
}

export function MailView({ onAskAgent }: { onAskAgent?: (prompt: string) => void }) {
  const [state, setState] = useState<MailState | null>(null)
  const [account, setAccount] = useState<string | undefined>()
  const [envelopes, setEnvelopes] = useState<MailEnvelope[]>([])
  const [selected, setSelected] = useState<MailEnvelope | null>(null)
  const [body, setBody] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [folders, setFolders] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const envelopesRef = useRef<MailEnvelope[]>([])

  envelopesRef.current = envelopes

  /**
   * Act on a message, then land on the next one.
   *
   * Optimistic: the row leaves the list before the server confirms, because
   * triage is a rhythm and a spinner between every keystroke breaks it. A
   * failure puts the row back and says what happened — the one thing that must
   * never happen is a message quietly vanishing from the list while still
   * sitting in the inbox.
   */
  const triage = useCallback(
    async (envelope: MailEnvelope, run: () => Promise<unknown>, undo: string) => {
      const before = envelopesRef.current

      setBusy(true)
      setNote(null)
      setSelected(nextAfter(before, envelope.id))
      setEnvelopes(before.filter(row => row.id !== envelope.id))

      try {
        await run()
      } catch (cause) {
        setEnvelopes(before)
        setSelected(envelope)
        setNote(`${undo} failed: ${cause instanceof Error ? cause.message : 'unknown error'}`)
      } finally {
        setBusy(false)
      }
    },
    []
  )

  const moveTo = useCallback(
    (envelope: MailEnvelope, kind: 'archive' | 'trash') => {
      // The user's own himalaya alias is the authoritative destination — they
      // configured it, and it already covers the account whose trash folder is
      // named in Korean. The folder-name guess is only for accounts that never
      // declared one, which for `archive` is most of them.
      const alias = kind === 'trash' ? TRASH_ALIAS : null
      const guess = kind === 'archive' ? archiveFolder(folders) : trashFolder(folders)

      if (!alias && !guess) {
        // Better to say the account has no such folder than to move mail
        // somewhere the user will never think to look for it.
        setNote(`This account has no ${kind} folder.`)

        return
      }

      const move = (target: string) => window.hermesDesktop.mail.move({ id: envelope.id, target, account })

      void triage(
        envelope,
        async () => {
          if (!alias) {
            return move(guess as string)
          }

          try {
            return await move(alias)
          } catch (cause) {
            // No alias declared for this account. Fall back rather than
            // reporting a failure the user cannot act on.
            if (!guess) {
              throw cause
            }

            return move(guess)
          }
        },
        kind
      )
    },
    [account, folders, triage]
  )


  useEffect(() => {
    let cancelled = false

    void window.hermesDesktop.mail
      .status()
      .then(status => {
        if (cancelled) {
          return
        }

        setState(status)
        setAccount(status.accounts.find(entry => entry.default)?.name ?? status.accounts[0]?.name)
      })
      .catch(() => setState({ installed: false, accounts: [] }))

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!state?.installed || !state.accounts.length) {
      setLoading(false)

      return
    }

    let cancelled = false

    setLoading(true)
    setError(null)

    void window.hermesDesktop.mail
      .list({ account, folder: 'INBOX', limit: LIST_LIMIT })
      .then(list => {
        if (!cancelled) {
          setEnvelopes(list)
          setLoading(false)
        }
      })
      .catch(caught => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Could not load mail.')
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [state, account])

  useEffect(() => {
    if (!selected) {
      setBody('')

      return
    }

    let cancelled = false

    setBody('Loading…')

    void window.hermesDesktop.mail
      .read({ id: selected.id, account, folder: 'INBOX' })
      .then(text => {
        if (!cancelled) {
          setBody(text)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBody('Could not read this message.')
        }
      })

    return () => {
      cancelled = true
    }
  }, [selected, account])

  // The folder list is what makes archive/trash resolvable at all: the
  // destination is named differently by every provider, so it is looked up
  // rather than assumed. See mail-actions.ts.
  useEffect(() => {
    let alive = true

    window.hermesDesktop.mail
      .folders({ account })
      .then(list => alive && setFolders(list))
      .catch(() => alive && setFolders([]))

    return () => {
      alive = false
    }
  }, [account])

  // Triage keys, the ones every mail client has had for twenty years. They are
  // ignored while typing so the search box still works.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null

      if (!selected || event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) {
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
        const seen = selected.seen

        void triage(
          selected,
          () => window.hermesDesktop.mail.flag({ id: selected.id, flag: 'Seen', remove: seen, account }),
          seen ? 'mark unread' : 'mark read'
        )
      }
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [account, moveTo, selected, triage])

  const unread = useMemo(() => envelopes.filter(envelope => !envelope.seen).length, [envelopes])

  // Flatten HTML mail to text before anything else touches it. Nothing
  // sender-controlled is ever rendered as markup — see mail-html.ts for why
  // that matters in a renderer holding window.hermesDesktop.
  const message = useMemo(() => {
    const split = splitMessage(body)

    return { ...split, body: htmlMailToText(split.body) }
  }, [body])

  if (state && !state.installed) {
    return (
      <div className="mx-auto flex h-full max-w-[36rem] flex-col items-center justify-center gap-3 px-6 text-center">
        <Codicon className="text-3xl opacity-50" name="mail" />
        <div className="text-[15px] font-semibold">Mail isn't connected yet</div>
        <p className="text-[13px] leading-relaxed opacity-65">
          Daat reads and sends mail through Himalaya, a small local mail client. Once it's installed and your account
          is configured, your inbox appears here — and the agent can triage, draft and (with your approval) send.
        </p>
      </div>
    )
  }

  if (state && !state.accounts.length) {
    return (
      <div className="mx-auto flex h-full max-w-[36rem] flex-col items-center justify-center gap-3 px-6 text-center">
        <Codicon className="text-3xl opacity-50" name="mail" />
        <div className="text-[15px] font-semibold">No mail account connected</div>
        <p className="text-[13px] leading-relaxed opacity-65">
          Daat reads mail through Himalaya, a small open-source IMAP client. Install it and run its account
          wizard once — Daat never sees your password.
        </p>
        <code className="rounded-md bg-(--ui-control-hover-background) px-2 py-1 text-[12px]">
          brew install himalaya && himalaya account configure
        </code>
        <p className="text-[12px] opacity-50">Then reopen this screen.</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Envelope list. */}
      <div className="flex w-[22rem] shrink-0 flex-col border-r border-(--stroke-nous)">
        <div className="flex items-center gap-2 px-4 pb-2 pt-6">
          <h1 className="text-[20px] font-bold tracking-tight">Inbox</h1>
          <span className="text-xs opacity-45">{unread} unread</span>
          {state && state.accounts.length > 1 ? (
            <select
              className="ml-auto rounded-md bg-(--ui-control-hover-background) px-1.5 py-0.5 text-[12px] outline-none"
              onChange={event => {
                setAccount(event.target.value)
                setSelected(null)
              }}
              value={account}
            >
              {state.accounts.map(entry => (
                <option key={entry.name} value={entry.name}>
                  {entry.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        <div className="px-4 pb-2">
          <input
            className="w-full rounded-md bg-(--ui-control-hover-background) px-2 py-1 text-[12.5px] outline-none placeholder:opacity-45"
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter') {
                return
              }

              const text = query.trim()

              setLoading(true)
              setError(null)

              const request = text
                ? window.hermesDesktop.mail.search({ query: text, account, limit: LIST_LIMIT })
                : window.hermesDesktop.mail.list({ account, limit: LIST_LIMIT })

              request
                .then(rows => {
                  setEnvelopes(rows)
                  setSelected(rows[0] ?? null)
                })
                .catch(cause => setError(cause instanceof Error ? cause.message : 'Search failed.'))
                .finally(() => setLoading(false))
            }}
            placeholder="Search — from dana, subject &quot;invoice 42&quot;"
            value={query}
          />
        </div>
        {note ? <div className="px-4 pb-2 text-[12px] text-(--dt-destructive)">{note}</div> : null}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {loading ? <div className="px-2 py-3 text-[13px] opacity-50">Loading inbox…</div> : null}
          {error ? <div className="px-2 py-3 text-[13px] text-(--dt-destructive)">{error}</div> : null}
          {envelopes.map(envelope => (
            <button
              className={cn(
                'flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-(--ui-control-hover-background)',
                selected?.id === envelope.id && 'bg-(--ui-control-active-background)'
              )}
              key={envelope.id}
              onClick={() => setSelected(envelope)}
            >
              <span className="flex items-center gap-1.5">
                {!envelope.seen ? <span className="size-1.5 shrink-0 rounded-full bg-(--dt-primary)" /> : null}
                <span className={cn('min-w-0 flex-1 truncate text-[13px]', !envelope.seen && 'font-semibold')}>
                  {envelope.fromName}
                </span>
                <span className="shrink-0 text-[11px] opacity-45">{relativeDate(envelope.date)}</span>
              </span>
              <span className="truncate text-[12.5px] opacity-75">{envelope.subject}</span>
            </button>
          ))}
          {!loading && !envelopes.length && !error ? (
            <div className="px-2 py-3 text-[13px] opacity-50">Inbox is empty.</div>
          ) : null}
        </div>
      </div>

      {/* Message. */}
      <div className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <>
            <div className="border-b border-(--stroke-nous) px-6 pb-3 pt-6">
              <h2 className="text-[18px] font-semibold leading-snug">{selected.subject}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] opacity-60">
                <span>{selected.fromName}</span>
                {selected.fromAddr ? <span className="opacity-70">&lt;{selected.fromAddr}&gt;</span> : null}
                <span>·</span>
                <span>{selected.date.slice(0, 16)}</span>
              </div>
              {onAskAgent ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <button
                    className="rounded-lg border border-(--stroke-nous) px-2.5 py-1 text-[12.5px] transition-colors hover:bg-(--ui-control-hover-background)"
                    onClick={() =>
                      onAskAgent(
                        `Summarize the email with id ${selected.id} in my INBOX (mail_read) in three bullets, then tell me if it needs a reply.`
                      )
                    }
                  >
                    ✦ Summarize
                  </button>
                  <button
                    className="rounded-lg border border-(--stroke-nous) px-2.5 py-1 text-[12.5px] transition-colors hover:bg-(--ui-control-hover-background)"
                    onClick={() =>
                      onAskAgent(
                        // mail_reply, NOT mail_draft. mail_draft composes a
                        // fresh message: it reads correctly and arrives in the
                        // recipient's client as a NEW conversation sitting
                        // beside the one it answers, with nothing to indicate
                        // anything went wrong. mail_reply carries In-Reply-To
                        // and References, which is what makes it a reply.
                        `Read email id ${selected.id} in my INBOX with mail_read, then draft a polite reply to it ` +
                          `using mail_reply with message_id "${selected.id}" so it threads under the original. ` +
                          `Do not send it — leave it in Drafts for me to review.`
                      )
                    }
                  >
                    ✦ Draft a reply
                  </button>
                  <button
                    className="rounded-lg border border-(--stroke-nous) px-2.5 py-1 text-[12.5px] transition-colors hover:bg-(--ui-control-hover-background)"
                    onClick={() =>
                      onAskAgent(
                        `Read email id ${selected.id} in my INBOX (mail_read) and save the key points as a note in my vault with vault_write, filed sensibly.`
                      )
                    }
                  >
                    ✦ Save to notes
                  </button>
                </div>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <pre className="whitespace-pre-wrap break-words font-sans text-[13.5px] leading-relaxed">
                {message.body}
              </pre>
            </div>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 opacity-55">
            <Codicon className="text-3xl" name="mail-read" />
            <span className="text-[13px]">Select a message to read it.</span>
          </div>
        )}
      </div>
    </div>
  )
}
