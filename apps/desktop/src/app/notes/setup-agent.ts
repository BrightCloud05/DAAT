/**
 * First-run setup, driven by the assistant.
 *
 * The difference this app is betting on: you don't arrive at an empty
 * notebook and a blinking cursor. The assistant opens the conversation, says
 * what it can work from, asks one question at a time, and builds the pages
 * itself as you answer. By the time you touch anything, the app is already
 * yours.
 *
 * Two rules make that safe enough to do without asking permission each time:
 * everything it creates is a plain markdown file in the user's own folder,
 * and every turn is undoable — we diff the vault around each turn, so "Undo"
 * removes exactly what that turn added and nothing else.
 */

import { atom } from 'nanostores'

import { PROMPT_SUBMIT_REQUEST_TIMEOUT_MS } from '@/hermes'
import { activeGateway } from '@/store/gateway'

import { $vaultInfo, $vaultNotes, refreshVaultNotes } from '../vault/store'

import type { Persona } from './personas'

export interface SetupMessage {
  id: string
  role: 'assistant' | 'user'
  text: string
  /** Paths this turn created, newest last. Empty for user messages. */
  created: string[]
  /** Set once the user has undone this turn's pages. */
  undone?: boolean
}

export type SetupStatus = 'idle' | 'thinking' | 'ready' | 'error'

export interface SetupState {
  status: SetupStatus
  messages: SetupMessage[]
  /** Short human line while the assistant works ("Making your pages…"). */
  activity: string | null
  error: string | null
}

const EMPTY: SetupState = { status: 'idle', messages: [], activity: null, error: null }

export const $setup = atom<SetupState>(EMPTY)

let sessionId: string | null = null
let unsubscribe: (() => void) | null = null
let counter = 0
/** Text accumulated from deltas this turn, to compare against the final text. */
let streamed = ''

/** Append to the open assistant message, or start one. */
function appendAssistantText(text: string): void {
  const state = $setup.get()
  const last = state.messages.at(-1)

  if (last?.role === 'assistant' && state.status === 'thinking') {
    update({ activity: null, messages: [...state.messages.slice(0, -1), { ...last, text: last.text + text }] })
  } else {
    update({ activity: null, messages: [...state.messages, { id: nextId(), role: 'assistant', text, created: [] }] })
  }
}

/** Overwrite the open assistant message with the authoritative full text. */
function replaceAssistantText(text: string): void {
  const state = $setup.get()
  const last = state.messages.at(-1)

  if (last?.role === 'assistant' && state.status === 'thinking') {
    update({ activity: null, messages: [...state.messages.slice(0, -1), { ...last, text }] })
  } else {
    update({ activity: null, messages: [...state.messages, { id: nextId(), role: 'assistant', text, created: [] }] })
  }
}

function nextId(): string {
  counter += 1

  return `m${counter}`
}

function update(patch: Partial<SetupState>): void {
  $setup.set({ ...$setup.get(), ...patch })
}

/** Tool names → one plain line. The user should never read a tool call. */
function activityFor(tool: string): string | null {
  if (tool.startsWith('vault_write') || tool.startsWith('money_add')) {return 'Making your pages…'}

  if (tool.startsWith('vault_read') || tool.startsWith('vault_search') || tool.startsWith('vault_list')) {
    return 'Looking through your notes…'
  }

  if (tool.startsWith('meeting_')) {return 'Listening to the recording…'}

  if (tool.startsWith('mail_')) {return 'Checking your mail…'}

  return 'Working…'
}

function currentPaths(): Set<string> {
  return new Set($vaultNotes.get().map(note => note.path))
}

async function ensureSession(persona: Persona): Promise<boolean> {
  if (sessionId) {
    return true
  }

  const gateway = activeGateway()

  if (!gateway) {
    update({ status: 'error', error: 'The assistant is still starting up. Give it a moment, or skip for now.' })

    return false
  }

  try {
    const created = (await gateway.request(
      'session.create',
      { title: `Setting up · ${persona.name}`, cwd: $vaultInfo.get()?.root ?? undefined },
      30_000
    )) as Record<string, unknown> | null

    sessionId = String(created?.session_id ?? created?.sid ?? created?.id ?? '') || null
  } catch (error) {
    update({
      status: 'error',
      error: error instanceof Error ? error.message : 'Could not reach the assistant.'
    })

    return false
  }

  if (!sessionId) {
    update({ status: 'error', error: 'The assistant did not start a session.' })

    return false
  }

  // One subscription for the whole conversation.
  unsubscribe = gateway.onEvent(event => {
    if (event.session_id !== sessionId) {
      return
    }

    // tui_gateway emits tool.start with {tool_id, name, args}.
    if (event.type === 'tool.start') {
      const payload = event.payload as { name?: unknown } | undefined
      const name = String(payload?.name ?? '')

      update({ activity: activityFor(name) })
    }

    if (event.type === 'message.delta') {
      const payload = event.payload as { text?: unknown } | undefined
      const text = typeof payload?.text === 'string' ? payload.text : ''

      if (!text) {
        return
      }

      streamed += text
      appendAssistantText(text)
    }

    // Not every provider streams. The Codex backend sends one
    // message.complete carrying the whole reply and no deltas at all — which
    // is how a 185-character greeting rendered as a single "?" on screen.
    // Trust complete's text whenever it is longer than what we streamed.
    if (event.type === 'message.complete') {
      const payload = event.payload as { text?: unknown } | undefined
      const full = typeof payload?.text === 'string' ? payload.text : ''

      if (full && full.length > streamed.length) {
        replaceAssistantText(full)
      }

      streamed = ''
    }
  })

  return true
}

/** Attribute everything created during a turn to that turn, for Undo. */
async function finishTurn(before: Set<string>): Promise<void> {
  await refreshVaultNotes()

  const created = [...currentPaths()].filter(path => !before.has(path))
  const state = $setup.get()
  const last = state.messages.at(-1)

  update({
    status: 'ready',
    activity: null,
    messages:
      last?.role === 'assistant' && created.length
        ? [...state.messages.slice(0, -1), { ...last, created }]
        : state.messages
  })
}

async function send(persona: Persona, prompt: string, visible: string | null): Promise<void> {
  if (!(await ensureSession(persona))) {
    return
  }

  const gateway = activeGateway()

  if (!gateway || !sessionId) {
    return
  }

  const before = currentPaths()

  streamed = ''

  update({
    status: 'thinking',
    error: null,
    activity: null,
    messages: visible
      ? [...$setup.get().messages, { id: nextId(), role: 'user', text: visible, created: [] }]
      : $setup.get().messages
  })

  try {
    await gateway.request('prompt.submit', { session_id: sessionId, text: prompt }, PROMPT_SUBMIT_REQUEST_TIMEOUT_MS)
  } catch (error) {
    update({
      status: 'error',
      activity: null,
      error: error instanceof Error ? error.message : 'The assistant stopped responding.'
    })

    return
  }

  await finishTurn(before)
}

/**
 * Open the conversation: the assistant speaks first, unprompted.
 *
 * Idempotent, because the guard belongs with the state it guards — React can
 * mount an effect twice (StrictMode, a remount) and the user must not get two
 * greetings and two sessions.
 */
export async function startSetup(persona: Persona): Promise<void> {
  if (sessionId || $setup.get().status !== 'idle') {
    return
  }

  $setup.set({ ...EMPTY, status: 'thinking' })
  await send(persona, persona.kickoff, null)
}

export async function replyToSetup(persona: Persona, text: string): Promise<void> {
  const trimmed = text.trim()

  if (!trimmed || $setup.get().status === 'thinking') {
    return
  }

  await send(persona, trimmed, trimmed)
}

/** Hand the assistant files the user dropped in. */
export async function offerFilesToSetup(persona: Persona, paths: string[]): Promise<void> {
  if (!paths.length) {
    return
  }

  const names = paths.map(path => path.split('/').pop() ?? path)
  const list = paths.map(path => `"${path}"`).join(', ')

  await send(
    persona,
    `The user gave you these files: ${list}. Read them — if a file is an image or a PDF, read it visually — ` +
      `and create the pages they imply with vault_write, following your setup brief. Then say in one or two ` +
      `sentences what you made.`,
    names.length === 1 ? `Here's ${names[0]}` : `Here are ${names.length} files: ${names.join(', ')}`
  )
}

/**
 * Remove the pages a single turn created.
 *
 * Deliberately not a general undo: it only touches paths recorded for that
 * turn, so a page the user edited afterwards is still theirs to lose — which
 * is why the button disappears once used.
 */
export async function undoTurn(messageId: string): Promise<void> {
  const state = $setup.get()
  const target = state.messages.find(message => message.id === messageId)

  if (!target?.created.length) {
    return
  }

  for (const path of target.created) {
    try {
      await window.hermesDesktop.vault.trash(path)
    } catch {
      // Already gone, or moved by the user. Nothing to undo for that one.
    }
  }

  await refreshVaultNotes()

  update({
    messages: $setup.get().messages.map(message =>
      message.id === messageId ? { ...message, undone: true, created: [] } : message
    )
  })
}

/** Leave setup: close the throwaway session, keep everything it built. */
export async function endSetup(): Promise<void> {
  unsubscribe?.()
  unsubscribe = null

  const gateway = activeGateway()

  if (gateway && sessionId) {
    try {
      await gateway.request('session.delete', { session_id: sessionId }, 10_000)
    } catch {
      // A leftover transcript is harmless.
    }
  }

  sessionId = null
  $setup.set(EMPTY)
}
