/**
 * The persona a user picked on first run, and what applying one does.
 *
 * Applying is deliberately small and reversible: it writes the assistant's
 * SOUL.md and seeds a few starter notes. Nothing is hidden, nothing is
 * locked — the user can edit or delete all of it afterwards, which is why we
 * can ask the question once and move on.
 */

import { atom } from 'nanostores'

import { getHermesConfigRecord, saveHermesConfig, updateProfileSoul } from '@/hermes'

import { refreshVaultNotes } from '../vault/store'

import { type Persona, personaById, type PersonaId, PERSONAS } from './personas'

const PERSONA_KEY = 'daat.persona.v1'
const DONE_KEY = 'daat.onboarded.v1'

export const $persona = atom<Persona | null>(readStoredPersona())
/** True once the user has been through (or dismissed) the first-run wizard. */
export const $onboarded = atom(readFlag(DONE_KEY))

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    // Storage unavailable (private mode, hardened profile): treat as done so
    // we never trap the user in a wizard we can't remember them finishing.
    return true
  }
}

function readStoredPersona(): Persona | null {
  try {
    return personaById(window.localStorage.getItem(PERSONA_KEY))
  } catch {
    return null
  }
}

function persist(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Non-fatal: the choice still applies to this session.
  }
}

/**
 * Turn on the toolsets a persona needs, without turning anything off.
 *
 * Additive on purpose: the user may have enabled something themselves before
 * (or after) picking a persona, and a first-run choice has no business
 * revoking it. A student simply isn't handed a terminal by default.
 */
async function applyToolsets(wanted: string[]): Promise<void> {
  if (!wanted.length) {
    return
  }

  const config = await getHermesConfigRecord()
  const current = Array.isArray(config.toolsets) ? config.toolsets.map(String) : []
  const merged = [...new Set([...current, ...wanted])]

  if (merged.length === current.length) {
    return
  }

  const result = await saveHermesConfig({ ...config, toolsets: merged })

  if (!result.ok) {throw new Error('Could not save assistant tools.')}
}

/**
 * The plugins Daat is built on. Without these the product is a text editor.
 *
 * `plugins/vault/plugin.yaml` declares `kind: standalone`, and hermes only
 * auto-loads bundled plugins of kind `backend` or `platform`
 * (hermes_cli/plugins.py). Everything else is opt-in through `plugins.enabled`
 * — and the seeded config.yaml has no `plugins:` block at all, because it is
 * copied verbatim from upstream, which has no reason to know about ours.
 *
 * So on a fresh Mac the agent had no vault_read, no vault_write, no
 * vault_search, and no pre_llm_call recall hook. The editor and the sidebar
 * work — those are Electron — so nothing looks broken. The agent simply cannot
 * see the vault, and answers from nothing while sounding just as certain.
 * Every machine except the one where this block was once added by hand.
 */
const DAAT_PLUGINS = ['vault', 'mail', 'meetings']

/**
 * Turn Daat's own plugins on, without turning anything off.
 *
 * Additive and idempotent, like applyToolsets: a user who disabled `mail`
 * would have it switched back on by a blunt overwrite, and a user who enabled
 * something of their own would lose it.
 */
export async function ensureDaatPlugins(): Promise<void> {
  const config = await getHermesConfigRecord()
  const plugins = (config.plugins ?? {}) as Record<string, unknown>
  const current = Array.isArray(plugins.enabled) ? plugins.enabled.map(String) : []

  // Only `vault` is added unconditionally — it IS the product. The others go
  // in on a first run, when there is nothing to have opted out of yet.
  const wanted = current.length ? ['vault'] : DAAT_PLUGINS
  const merged = [...new Set([...current, ...wanted])]

  /*
   * `memory.provider` is the same story one level up: the Settings screen
   * shows "Built-in only", which is upstream's empty default, and the built-in
   * store writes to ~/.daat/memories — files the user was told they own but
   * cannot see. Selecting the vault provider is what turns filing from a
   * request in the system prompt into something that runs at session end.
   *
   * Only when it is unset. A user who picked a provider picked it.
   */
  const memory = (config.memory ?? {}) as Record<string, unknown>
  const wantsMemory = !String(memory.provider ?? '').trim()

  /*
   * Enabling a plugin is only half the wiring: its tools register under a
   * toolset of the same name, and a toolset absent from `toolsets:` is never
   * expanded (toolsets.py). The seeded config has no `toolsets:` block either,
   * so without this the vault plugin loads and its tools stay invisible —
   * exactly the "agent can't see my notes" fresh-Mac failure.
   *
   * When the key is unset the runtime default is `hermes-cli`; seed it before
   * merging so writing the key never strips the default toolset.
   */
  const currentToolsets = Array.isArray(config.toolsets) ? config.toolsets.map(String) : ['hermes-cli']
  const mergedToolsets = [...new Set([...currentToolsets, ...wanted])]

  const changed =
    merged.length !== current.length ||
    mergedToolsets.length !== currentToolsets.length ||
    !Array.isArray(config.toolsets) ||
    wantsMemory

  if (!changed) {
    return
  }

  const result = await saveHermesConfig({
    ...config,
    memory: wantsMemory ? { ...memory, provider: 'vault' } : memory,
    plugins: { ...plugins, enabled: merged },
    toolsets: mergedToolsets
  })

  if (!result.ok) {throw new Error('Could not enable the notes assistant.')}
}

export interface ApplyPersonaResult {
  notesCreated: number
  soulError: string | null
  errors: string[]
}

export async function applyPersona(id: PersonaId): Promise<ApplyPersonaResult> {
  const persona = personaById(id)

  if (!persona) {return { notesCreated: 0, soulError: null, errors: [] }}
  $persona.set(persona)
  persist(PERSONA_KEY, persona.id)
  const errors: string[] = []
  let soulError: string | null = null
  let notesCreated = 0
  const detail = (error: unknown) => (error instanceof Error ? error.message : String(error))

  try {
    await ensureDaatPlugins()
  } catch (error) {
    errors.push(detail(error))
  }

  try {
    const result = await updateProfileSoul('default', persona.soul)

    if (!result.ok) {throw new Error('Could not save assistant preferences.')}
  } catch (error) {
    soulError = detail(error)
    errors.push(soulError)
  }

  try {
    await applyToolsets(persona.toolsets)
  } catch (error) {
    errors.push(detail(error))
  }

  try {
    const vault = window.hermesDesktop.vault
    const root = (await vault.info()).root

    if (!root) {throw new Error('Choose a notes folder first.')}

    for (const [relPath, content] of Object.entries(persona.starters)) {
      try {
        // Exclusive creation distinguishes an existing blank/cloud file from
        // a new starter without a read-then-overwrite race.
        const created = await vault.createNote(relPath, root)

        if (!created.created) {continue}
        const result = await vault.write(relPath, content, created.mtimeMs, created.content, root)

        if (!result.ok) {throw new Error('Could not save this starter note.')}
        notesCreated += 1
      } catch (error) {
        errors.push(`${relPath}: ${detail(error)}`)
      }
    }

    await refreshVaultNotes()
  } catch (error) {
    errors.push(detail(error))
  }

  return { notesCreated, soulError, errors }
}

export function finishOnboarding(): void {
  $onboarded.set(true)
  persist(DONE_KEY, '1')
}

export { PERSONAS }
