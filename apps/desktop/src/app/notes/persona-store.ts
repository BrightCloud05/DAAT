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
import { PERSONAS, personaById, type Persona, type PersonaId } from './personas'

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

  await saveHermesConfig({ ...config, toolsets: merged })
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

  await saveHermesConfig({
    ...config,
    memory: wantsMemory ? { ...memory, provider: 'vault' } : memory,
    plugins: { ...plugins, enabled: merged },
    toolsets: mergedToolsets
  })
}

export interface ApplyPersonaResult {
  notesCreated: number
  /** Set when the assistant's voice couldn't be written (backend still booting). */
  soulError: string | null
}

export async function applyPersona(id: PersonaId): Promise<ApplyPersonaResult> {
  const persona = personaById(id)

  if (!persona) {
    return { notesCreated: 0, soulError: null }
  }

  $persona.set(persona)
  persist(PERSONA_KEY, persona.id)

  let soulError: string | null = null

  // Before the soul write, so a backend that is still booting fails the
  // cosmetic step rather than the one the vault depends on.
  try {
    await ensureDaatPlugins()
  } catch {
    // Retried on next launch by the boot path in notes-shell.
  }

  try {
    // "default" is HERMES_HOME itself, so this writes ~/.daat/SOUL.md.
    await updateProfileSoul('default', persona.soul)
  } catch (error) {
    // The Python backend may still be starting on first run. The persona is
    // remembered either way; Settings can re-apply it.
    soulError = error instanceof Error ? error.message : String(error)
  }

  try {
    await applyToolsets(persona.toolsets)
  } catch {
    // Same story — the vault tools work regardless, and Settings → Toolsets
    // is the place this can be corrected by hand.
  }

  let notesCreated = 0

  for (const [relPath, content] of Object.entries(persona.starters)) {
    try {
      const existing = await window.hermesDesktop.vault.read(relPath).catch(() => null)

      // Never overwrite something the user already has under that name.
      // `dataless` matters: an iCloud-evicted file reads back as empty rather
      // than failing, so without this a second Mac would replace the user's
      // customised template with the starter.
      if (existing && (existing.dataless || existing.content.trim())) {
        continue
      }

      const result = await window.hermesDesktop.vault.write(relPath, content, null)

      if (result.ok) {
        notesCreated += 1
      }
    } catch {
      // One starter failing must not abort the rest of setup.
    }
  }

  await refreshVaultNotes()

  return { notesCreated, soulError }
}

export function finishOnboarding(): void {
  $onboarded.set(true)
  persist(DONE_KEY, '1')
}

export { PERSONAS }
