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

const PERSONA_KEY = 'biseo.persona.v1'
const DONE_KEY = 'biseo.onboarded.v1'

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

  try {
    // "default" is HERMES_HOME itself, so this writes ~/.biseo/SOUL.md.
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
