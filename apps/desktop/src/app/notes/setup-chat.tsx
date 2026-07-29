/**
 * The first-run conversation.
 *
 * Centre of the screen, covering the app, because on a first run this IS the
 * app — there is nothing behind it worth looking at yet. The assistant speaks
 * first and does the work; the user answers one question at a time and can
 * hand over files by dropping them anywhere on this screen.
 *
 * Everything it builds is listed under the message that built it, with an
 * Undo. That is what makes "just do it" acceptable instead of alarming.
 */

import { useStore } from '@nanostores/react'
import { useEffect, useRef, useState } from 'react'

import { BrandMark } from '@/components/brand-mark'
import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

import type { Persona } from './personas'
import { $setup, offerFilesToSetup, replyToSetup, startSetup, undoTurn } from './setup-agent'
import { $productLocale, productStrings } from './strings'

export function SetupChat({ persona, onDone }: { persona: Persona; onDone: () => void }) {
  const setup = useStore($setup)
  const s = productStrings(useStore($productLocale))
  const [draft, setDraft] = useState('')
  const [dragging, setDragging] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // The assistant opens the conversation. startSetup is idempotent, so a
  // double mount can't produce two greetings.
  useEffect(() => {
    void startSetup(persona)
  }, [persona])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [setup.messages, setup.activity])

  const submit = () => {
    const text = draft.trim()

    if (!text) {
      return
    }

    setDraft('')
    void replyToSetup(persona, text)
  }

  const busy = setup.status === 'thinking'

  return (
    <div
      className="fixed inset-0 z-(--z-onboarding) flex items-center justify-center bg-(--ui-chat-surface-background) p-6"
      onDragLeave={() => setDragging(false)}
      onDragOver={event => {
        event.preventDefault()
        setDragging(true)
      }}
      onDrop={event => {
        event.preventDefault()
        setDragging(false)

        const paths = [...event.dataTransfer.files]
          .map(file => window.hermesDesktop.getPathForFile(file))
          .filter(Boolean)

        void offerFilesToSetup(persona, paths)
      }}
    >
      <div
        className={cn(
          'flex h-full max-h-[42rem] w-full max-w-[40rem] flex-col rounded-2xl border transition-colors',
          dragging ? 'border-(--dt-primary)' : 'border-(--stroke-nous)'
        )}
        style={{ animation: 'biseo-lift 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both' }}
      >
        <div className="flex shrink-0 items-center gap-2.5 border-b border-(--stroke-nous) px-5 py-3.5">
          <BrandMark className="size-[22px] rounded-[6px]" />
          <span className="text-[13px] font-semibold">{s.settingUpTitle}</span>
          <button
            className="ml-auto rounded-md px-2 py-1 text-[12.5px] opacity-45 transition-all hover:bg-(--ui-control-hover-background) hover:opacity-90"
            onClick={onDone}
          >
            {s.imDone}
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-5" ref={scrollRef}>
          {setup.messages.map(message => (
            <div
              className={cn('flex flex-col gap-1.5', message.role === 'user' ? 'items-end' : 'items-start')}
              key={message.id}
            >
              <div
                className={cn(
                  'max-w-[85%] whitespace-pre-wrap text-[14px] leading-relaxed',
                  message.role === 'user' &&
                    'rounded-2xl rounded-br-md bg-(--ui-control-hover-background) px-3.5 py-2'
                )}
              >
                {message.text}
              </div>

              {/* What this turn built, and the way back out of it. */}
              {message.created.length ? (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5 text-[12px] opacity-60">
                  <Codicon className="text-[11px] text-(--dt-primary)" name="check" />
                  <span>{s.madePages(message.created.length)}</span>
                  <button
                    className="underline underline-offset-2 hover:opacity-100"
                    onClick={() => void undoTurn(message.id)}
                  >
                    {s.undo}
                  </button>
                </div>
              ) : null}

              {message.undone ? <span className="text-[12px] opacity-40">{s.undone}</span> : null}
            </div>
          ))}

          {setup.activity ? (
            <div className="flex items-center gap-2 text-[13px] opacity-55">
              <span
                className="size-1.5 rounded-full bg-(--dt-primary)"
                style={{ animation: 'biseo-pulse 1.2s ease-in-out infinite' }}
              />
              {setup.activity}
            </div>
          ) : busy && !setup.messages.length ? (
            <div className="text-[13px] opacity-50">{s.loading}</div>
          ) : null}

          {setup.error ? (
            <div className="flex items-start gap-2 rounded-lg bg-[rgba(255,59,48,0.10)] px-3 py-2 text-[12.5px]">
              <Codicon className="mt-0.5 shrink-0" name="warning" />
              <span>{setup.error}</span>
            </div>
          ) : null}
        </div>

        <div className="shrink-0 border-t border-(--stroke-nous) px-5 py-3.5">
          <div className="flex items-end gap-2">
            <textarea
              autoFocus
              className="max-h-28 min-h-[38px] flex-1 resize-none rounded-xl bg-(--ui-control-hover-background) px-3.5 py-2.5 text-[14px] outline-none placeholder:opacity-45"
              onChange={event => setDraft(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  submit()
                }
              }}
              placeholder={s.setupPlaceholder}
              rows={1}
              value={draft}
            />
            <button
              className="grid size-[38px] shrink-0 place-items-center rounded-xl bg-(--dt-primary) text-white transition-opacity hover:opacity-90 disabled:opacity-35"
              disabled={busy || !draft.trim()}
              onClick={submit}
              title={s.send}
            >
              <Codicon className="text-[15px]" name="arrow-up" />
            </button>
          </div>
          <p className="mt-2 text-[11.5px] opacity-45">{s.dropAnything}</p>
        </div>
      </div>
    </div>
  )
}
