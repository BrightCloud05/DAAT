/**
 * New chat, and the conversations you had before.
 *
 * The agent panel showed one live conversation with no way to start another and
 * no history — which meant every question you ever asked it piled into a single
 * thread you could not leave or return to.
 *
 * Deliberately NOT the chat shell's sidebar. That sidebar is a resident,
 * reorderable, grouped tree, and it is right for an app whose subject IS the
 * conversation. Daat's subject is the note; the agent is summoned with ⌘J and
 * dismissed. A permanent list of chats would make it furniture. So: one button
 * to start fresh, and the recent ones behind the title.
 */

import { useStore } from '@nanostores/react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'
import { $sessions } from '@/store/session'

import { NEW_CHAT_ROUTE, sessionRoute } from '../routes'
import { $productLocale, productStrings } from './strings'

/** Enough to find the one you meant; more than this wants a real sidebar. */
const RECENT_LIMIT = 8

function whenLabel(ms: number, locale: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - ms) / 60_000))

  if (minutes < 1) return locale === 'ko' ? '방금' : 'just now'
  if (minutes < 60) return locale === 'ko' ? `${minutes}분 전` : `${minutes}m ago`

  const hours = Math.round(minutes / 60)

  if (hours < 24) return locale === 'ko' ? `${hours}시간 전` : `${hours}h ago`

  return new Date(ms).toLocaleDateString(locale === 'ko' ? 'ko-KR' : undefined, {
    day: 'numeric',
    month: 'short'
  })
}

/** A conversation's name: its title, else the first thing you said to it. */
export function sessionLabel(session: { title: null | string; preview: null | string }, fallback: string): string {
  const title = session.title?.trim()

  if (title) {
    return title
  }

  const preview = session.preview?.replace(/\s+/g, ' ').trim()

  return preview ? preview.slice(0, 60) : fallback
}

export function AgentSessions({ onPick }: { onPick?: () => void }) {
  const navigate = useNavigate()
  const locale = useStore($productLocale)
  const s = productStrings(locale)
  const sessions = useStore($sessions)
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // Close on a click anywhere else, and on Escape. Without this the menu
  // survives a click into the conversation behind it and sits there covering
  // the reply the user was reading.
  useEffect(() => {
    if (!open) {
      return
    }

    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const recent = [...sessions]
    .filter(session => !session.archived)
    .sort((a, b) => b.last_active - a.last_active)
    .slice(0, RECENT_LIMIT)

  const go = (to: string) => {
    setOpen(false)
    navigate(to)
    onPick?.()
  }

  return (
    <>
      <button
        className="grid size-6 shrink-0 place-items-center rounded-xs transition-colors hover:bg-(--ui-control-hover-background)"
        onClick={() => go(NEW_CHAT_ROUTE)}
        title={s.newChat}
        aria-label={s.newChat}
      >
        <Codicon className="text-[13px]" name="add" />
      </button>

      <div className="relative" ref={menuRef}>
        <button
          aria-expanded={open}
          aria-label={s.recentChats}
          className={cn(
            'grid size-6 shrink-0 place-items-center rounded-xs transition-colors hover:bg-(--ui-control-hover-background)',
            open && 'bg-(--ui-control-active-background)'
          )}
          onClick={() => setOpen(value => !value)}
          title={s.recentChats}
        >
          <Codicon className="text-[13px]" name="history" />
        </button>

        {open ? (
          <div
            className="absolute right-0 top-7 z-30 w-[19rem] rounded-xs border border-(--stroke-nous) bg-(--dt-popover) py-1 shadow-[0_10px_30px_-18px_rgba(0,0,0,0.6)]"
            style={{ animation: 'daat-lift 140ms ease-out both' }}
          >
            {recent.length ? (
              recent.map(session => (
                <button
                  className="flex w-full items-baseline gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-(--ui-control-hover-background)"
                  key={session.id}
                  onClick={() => go(sessionRoute(session.id))}
                >
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    {sessionLabel(session, s.untitledChat)}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums opacity-40">
                    {whenLabel(session.last_active, locale)}
                  </span>
                </button>
              ))
            ) : (
              <div className="px-2.5 py-2 text-[12.5px] opacity-50">{s.noChatsYet}</div>
            )}
          </div>
        ) : null}
      </div>
    </>
  )
}
