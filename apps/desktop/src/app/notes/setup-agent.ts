/**
 * First-run setup: fixed questions, AI answers.
 *
 * The questions are hard-coded and rendered instantly. They are the same
 * every time a given persona runs setup, so having a model write them bought
 * nothing and cost a word-by-word reveal that was genuinely unreadable at
 * heading size. What actually needs a model is the other direction: turning
 * "linear algebra, stats, two history units" into real pages with the right
 * frontmatter. That is all it does here.
 *
 * Nothing the assistant says is shown. Each step reports a fact — "Made 4
 * pages" — with an Undo, because we diff the vault around the step and can
 * remove exactly what it added. That is what makes "just do it for me" safe
 * to offer without a confirmation on every write.
 */

import { atom } from 'nanostores'

import { getProfileSoul, PROMPT_SUBMIT_REQUEST_TIMEOUT_MS, updateProfileSoul } from '@/hermes'
import { activeGateway } from '@/store/gateway'

import { $vaultInfo, $vaultNotes, refreshVaultNotes } from '../vault/store'

import type { Persona } from './personas'

export interface SetupStep {
  /** Index into the persona's question list. */
  question: number
  /** What the user typed, or null when they skipped. */
  answer: string | null
  /** Vault paths this step created. Emptied by undo. */
  created: string[]
  undone?: boolean
}

export type SetupStatus = 'asking' | 'working' | 'done' | 'error'

export interface SetupState {
  status: SetupStatus
  /** Which question is on screen. */
  index: number
  steps: SetupStep[]
  /** Short human line while the assistant works. */
  activity: string | null
  error: string | null
}

const EMPTY: SetupState = { status: 'asking', index: 0, steps: [], activity: null, error: null }

export const $setup = atom<SetupState>(EMPTY)

let sessionId: string | null = null
let unsubscribe: (() => void) | null = null

function update(patch: Partial<SetupState>): void {
  $setup.set({ ...$setup.get(), ...patch })
}

/** Tool names → one plain line. The user should never read a tool call. */
function activityFor(tool: string): string {
  if (tool.startsWith('vault_write') || tool.startsWith('money_add')) {return 'Making your pages…'}

  if (tool.startsWith('vault_read') || tool.startsWith('vault_search') || tool.startsWith('vault_list')) {
    return 'Reading what you have…'
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
    update({ status: 'error', error: 'The assistant is still starting up. Give it a moment, or skip setup.' })

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
    update({ status: 'error', error: error instanceof Error ? error.message : 'Could not reach the assistant.' })

    return false
  }

  if (!sessionId) {
    update({ status: 'error', error: 'The assistant did not start a session.' })

    return false
  }

  // Only tool activity is surfaced. The assistant's prose is deliberately
  // ignored — the screen shows fixed questions and finished pages, not chat.
  unsubscribe = gateway.onEvent(event => {
    if (event.session_id !== sessionId) {
      return
    }

    if (event.type === 'tool.start') {
      const payload = event.payload as { name?: unknown } | undefined

      update({ activity: activityFor(String(payload?.name ?? '')) })
    }
  })

  return true
}

/**
 * Record how the user wants the assistant to behave.
 *
 * Their own words go into SOUL.md verbatim, appended rather than replacing
 * the persona's voice. Verbatim on purpose: "never guess a number, always
 * cite the source" is already a better instruction than any paraphrase, and
 * it needs no model round-trip — the answer takes effect the moment they
 * press return.
 */
async function rememberPreferences(answer: string): Promise<void> {
  // "default" is HERMES_HOME itself, so this is ~/.daat/SOUL.md.
  const current = await getProfileSoul('default')
  const existing = typeof current?.content === 'string' ? current.content : ''
  const section = `\n\n## How I like to work\n\n${answer.trim()}\n`

  await updateProfileSoul('default', `${existing.trimEnd()}${section}`)
}

/** Move to the next question, or finish. */
function advance(persona: Persona): void {
  const next = $setup.get().index + 1

  update({
    index: next,
    status: next >= persona.questions.length ? 'done' : 'asking',
    activity: null
  })
}

/**
 * Hand one answer to the assistant and record what it built.
 *
 * The vault diff is taken around the whole turn, which is why Undo can be
 * exact: whatever appeared between the prompt going out and the turn ending
 * belongs to this step and nothing else.
 */
export async function answerQuestion(persona: Persona, answer: string): Promise<void> {
  const state = $setup.get()
  const question = persona.questions[state.index]

  if (!question || state.status === 'working') {
    return
  }

  // Preferences never reach the model; they change how it behaves instead.
  if (question.kind === 'preferences') {
    update({ status: 'working', error: null, activity: null })

    try {
      await rememberPreferences(answer)
    } catch (error) {
      update({
        status: 'asking',
        activity: null,
        error: error instanceof Error ? error.message : "Couldn't save that preference."
      })

      return
    }

    update({ steps: [...$setup.get().steps, { question: state.index, answer, created: [] }] })
    advance(persona)

    return
  }

  if (!(await ensureSession(persona))) {
    return
  }

  const gateway = activeGateway()

  if (!gateway || !sessionId) {
    return
  }

  const before = currentPaths()

  update({ status: 'working', error: null, activity: null })

  try {
    await gateway.request(
      'prompt.submit',
      {
        session_id: sessionId,
        text:
          `The user was asked: "${question.ask}"\nThey answered: "${answer}"\n\n` +
          `${question.instruction}\n\n` +
          'Do the work now. Do not ask follow-up questions and do not explain — this runs behind a fixed ' +
          'setup screen and your prose is not shown. Never invent a detail the user did not give.'
      },
      PROMPT_SUBMIT_REQUEST_TIMEOUT_MS
    )
  } catch (error) {
    update({
      status: 'asking',
      activity: null,
      error: error instanceof Error ? error.message : 'The assistant stopped responding.'
    })

    return
  }

  await refreshVaultNotes()

  const created = [...currentPaths()].filter(path => !before.has(path))

  update({ steps: [...$setup.get().steps, { question: state.index, answer, created }] })
  advance(persona)
}

/** Skip the question on screen without asking the assistant anything. */
export function skipQuestion(persona: Persona): void {
  const state = $setup.get()

  if (state.status === 'working') {
    return
  }

  update({ steps: [...state.steps, { question: state.index, answer: null, created: [] }] })
  advance(persona)
}

/** Hand the assistant files the user dropped, against the current question. */
export async function offerFilesToSetup(persona: Persona, paths: string[]): Promise<void> {
  if (!paths.length) {
    return
  }

  const names = paths.map(path => path.split('/').pop() ?? path).join(', ')

  await answerQuestion(persona, `I've given you these files: ${paths.map(p => `"${p}"`).join(', ')} (${names}). ` +
    'Read them — if a file is an image or a PDF, read it visually — and use what they say.')
}

/** Remove the pages one step created. */
export async function undoStep(index: number): Promise<void> {
  const step = $setup.get().steps[index]

  if (!step?.created.length) {
    return
  }

  for (const path of step.created) {
    try {
      await window.hermesDesktop.vault.trash(path)
    } catch {
      // Already gone, or moved by the user. Nothing to undo for that one.
    }
  }

  await refreshVaultNotes()

  update({
    steps: $setup.get().steps.map((entry, position) =>
      position === index ? { ...entry, created: [], undone: true } : entry
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
