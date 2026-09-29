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
 * Results remain visible. Undo owns only confirmed new tool writes whose
 * contents have not changed since creation, never the whole vault diff.
 */

import { atom } from 'nanostores'

import { getProfileSoul, updateProfileSoul } from '@/hermes'
import { activeGateway } from '@/store/gateway'

import { $vaultInfo, $vaultNotes, refreshVaultNotes } from '../vault/store'

import { submitAndAwaitTurn } from './agent-turn'
import type { Persona } from './personas'
import { $productLocale, productStrings } from './strings'

export interface SetupStep {
  /** Index into the persona's question list. */
  question: number
  /** What the user typed, or null when they skipped. */
  answer: string | null
  /** Vault paths this step created. Emptied by undo. */
  created: string[]
  undone?: boolean
  files?: boolean
  originals?: Array<{ path: string; content: string; root: string }>
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
  result?: string | null
}

const EMPTY: SetupState = { status: 'asking', index: 0, steps: [], activity: null, error: null }

export const $setup = atom<SetupState>(EMPTY)

let sessionId: string | null = null
let generation = 0
let unsubscribe: (() => void) | null = null

function update(patch: Partial<SetupState>): void {
  $setup.set({ ...$setup.get(), ...patch })
}

/** Tool names → one plain line. The user should never read a tool call. */
function activityFor(tool: string): string {
  if (tool.startsWith('vault_write')) {
    return 'Making your pages…'
  }

  if (tool.startsWith('vault_read') || tool.startsWith('vault_search') || tool.startsWith('vault_list')) {
    return 'Reading what you have…'
  }

  if (tool.startsWith('meeting_')) {
    return 'Listening to the recording…'
  }

  if (tool.startsWith('mail_')) {
    return 'Checking your mail…'
  }

  return 'Working…'
}

function currentPaths(): Set<string> {
  return new Set($vaultNotes.get().map(note => note.path))
}

async function ensureSession(persona: Persona, run: number): Promise<boolean> {
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

    const id = String(created?.session_id ?? created?.sid ?? created?.id ?? '') || null

    if (run !== generation) {
      if (id) {await gateway.request('session.delete', { session_id: id }, 10_000)}

      return false
    }

    sessionId = id
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

  const saved = await updateProfileSoul('default', `${existing.trimEnd()}${section}`)

  if (!saved.ok) {throw new Error('Could not save that preference.')}
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
 * Confirmed tool writes identify what this step owns. Concurrent external
 * changes are never claimed as setup output.
 */
export async function answerQuestion(
  persona: Persona,
  answer: string,
  options: { files?: boolean } = {}
): Promise<boolean> {
  const state = $setup.get()
  const question = persona.questions[state.index]

  if (!question || state.status === 'working') {return false}
  const run = generation
  update({ status: 'working', error: null, activity: null, result: null })

  if (question.kind === 'preferences' && !options.files) {
    try {
      await rememberPreferences(answer)
    } catch (error) {
      if (run === generation)
        {update({ status: 'asking', error: error instanceof Error ? error.message : "Couldn't save that preference." })}

      return false
    }

    if (run !== generation) {return false}
    update({ steps: [...$setup.get().steps, { question: state.index, answer, created: [] }] })
    advance(persona)

    return true
  }

  try {
    if (!(await ensureSession(persona, run)) || run !== generation) {return false}
    const gateway = activeGateway()

    if (!gateway || !sessionId) {return false}
    const root = $vaultInfo.get()?.root

    if (!root) {
      update({ status: 'asking', error: 'Choose a notes folder first.' })

      return false
    }

    await refreshVaultNotes()
    const before = currentPaths()
    const written = new Map<string, string>()

    const turn = await submitAndAwaitTurn(
      gateway,
      sessionId,
      (options.files
        ? `The user supplied these files for their ${persona.name} workspace: ${answer}\nRead the supplied files and create useful notes in the vault from their contents. Do not save file paths as personality or work preferences. `
        : `The user was asked: ${JSON.stringify(question.ask)}\nThey answered: ${JSON.stringify(answer)}\n${question.instruction ?? ''}\n`) +
        'Use vault_write for notes. Never invent details. Return a brief factual summary of what you created or why you could not finish.',
      {
        onEvent: event => {
          const payload = event.payload as
            { name?: string; args?: { path?: string; content?: string }; result?: unknown } | undefined

          if (
            event.type !== 'tool.complete' ||
            payload?.name !== 'vault_write' ||
            typeof payload.args?.path !== 'string' ||
            typeof payload.args.content !== 'string'
          )
            {return}

          const path = /\.(md|markdown)$/i.test(payload.args.path) ? payload.args.path : `${payload.args.path}.md`

          if (typeof payload.result === 'string' && payload.result.startsWith(`Wrote ${path} (`))
            {written.set(path, payload.args.content)}
        }
      }
    )

    if (run !== generation) {return false}

    if (turn.error) {
      update({ status: 'asking', activity: null, error: turn.error })

      return false
    }

    await refreshVaultNotes()

    if (run !== generation) {return false}
    // Only confirmed writes from this turn are eligible for Undo. A vault-wide
    // diff also includes iCloud and other windows' unrelated new notes.
    const originals: Array<{ path: string; content: string; root: string }> = []

    for (const [path, content] of written) {
      if (before.has(path)) {continue}

      try {
        const file = await window.hermesDesktop.vault.read(path, root)

        if (!file.dataless && file.content === content) {originals.push({ path, content, root })}
      } catch {
        /* A file that cannot be verified is never claimed for Undo. */
      }
    }

    update({
      steps: [
        ...$setup.get().steps,
        { question: state.index, answer, files: options.files, created: originals.map(file => file.path), originals }
      ],
      result: turn.text,
      activity: null
    })

    if (options.files) {update({ status: 'asking' })}
    else {advance(persona)}

    return true
  } catch (error) {
    if (run === generation)
      {update({ status: 'asking', activity: null, error: error instanceof Error ? error.message : String(error) })}

    return false
  }
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

  await answerQuestion(
    persona,
    `I've given you these files: ${paths.map(p => `"${p}"`).join(', ')} (${names}). ` +
      'Read them — if a file is an image or a PDF, read it visually — and use what they say.',
    { files: true }
  )
}

/** Remove the pages one step created. */
export async function undoStep(index: number): Promise<void> {
  const step = $setup.get().steps[index]

  if (!step?.created.length) {
    return
  }

  const remaining: string[] = []

  for (const path of step.created) {
    const original = step.originals?.find(file => file.path === path)

    if (!original) {
      remaining.push(path)

      continue
    }

    try {
      const current = await window.hermesDesktop.vault.read(path, original.root)

      if (current.dataless || current.content !== original.content) {
        remaining.push(path)

        continue
      }

      await window.hermesDesktop.vault.trash(path, original.root)
    } catch {
      remaining.push(path)
    }
  }

  await refreshVaultNotes()
  update({
    error: remaining.length ? productStrings($productLocale.get()).calendarEntryChanged : null,
    steps: $setup
      .get()
      .steps.map((entry, position) =>
        position === index ? { ...entry, created: remaining, undone: !remaining.length } : entry
      )
  })
}

/** Leave setup: close the throwaway session, keep everything it built. */
export async function endSetup(): Promise<void> {
  ++generation
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
