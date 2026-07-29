/**
 * Templates live as plain notes in <vault>/Templates — user-visible,
 * user-editable (the Obsidian convention). {{date}} / {{time}} / {{title}}
 * substitute on use. Daily notes are Templates/Daily.md applied into
 * Daily/YYYY-MM-DD.md.
 */

import { $vaultNotes, createNote, openNote, refreshVaultNotes } from '../vault/store'
import { $editorView } from '../vault/editor-bridge'

const vault = () => window.hermesDesktop.vault

export interface TemplateInfo {
  name: string
  path: string
}

export async function listTemplates(): Promise<TemplateInfo[]> {
  try {
    const entries = await vault().listDir('Templates')

    return entries
      .filter(entry => entry.kind === 'note')
      .map(entry => ({ name: entry.name.replace(/\.(md|markdown)$/i, ''), path: entry.path }))
  } catch {
    return []
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function todayStamp(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function fillTemplate(content: string, title: string): string {
  const now = new Date()

  return content
    .replaceAll('{{date}}', todayStamp(now))
    .replaceAll('{{time}}', `${pad(now.getHours())}:${pad(now.getMinutes())}`)
    .replaceAll('{{title}}', title)
}

/** True for notes under Templates/ — the editor treats them as source, not pages. */
export function isTemplateNote(relPath: string | null | undefined): boolean {
  return Boolean(relPath && /^templates\//i.test(relPath))
}

/** Replace the whole current document with a filled template (undoable). */
export async function applyTemplateToActive(templatePath: string, title: string): Promise<void> {
  const view = $editorView.get()

  if (!view) {
    return
  }

  const template = await vault().read(templatePath)
  const filled = fillTemplate(template.content, title)

  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: filled } })
  view.focus()
}

/** Open (creating if needed) today's daily note, applying Templates/Daily.md. */
export async function openDailyNote(): Promise<void> {
  const stamp = todayStamp()
  const relPath = `Daily/${stamp}.md`
  const existed = $vaultNotes.get().some(note => note.path === relPath)

  await createNote(relPath)

  if (!existed) {
    const templates = await listTemplates()
    const daily = templates.find(template => template.name.toLowerCase() === 'daily')

    if (daily) {
      await applyTemplateToActive(daily.path, stamp)
    }

    await refreshVaultNotes()
  } else {
    await openNote(relPath)
  }
}
