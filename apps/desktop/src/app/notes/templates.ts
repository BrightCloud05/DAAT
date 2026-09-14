/**
 * Templates live as plain notes in <vault>/Templates — user-visible,
 * user-editable (the Obsidian convention). {{date}} / {{time}} / {{title}}
 * substitute on use. Daily notes are Templates/Daily.md applied into
 * Daily/YYYY-MM-DD.md.
 */

import type { EditorView } from '@codemirror/view'

import { $editorView } from '../vault/editor-bridge'
import { $activeNote, createNote, refreshVaultNotes } from '../vault/store'

import { closeTableView } from './view-store'

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

/**
 * Resolve once the editor pane has mounted and registered its view.
 *
 * Callers that switch the canvas to the note view and immediately apply a
 * template would otherwise read a null view on the same tick and silently do
 * nothing — the "Start today's plan" button that created a blank note.
 */
export async function waitForEditor(timeoutMs = 2000): Promise<EditorView | null> {
  const existing = $editorView.get()

  if (existing) {
    return existing
  }

  return new Promise(resolve => {
    const timer = setTimeout(() => {
      unsubscribe()
      resolve(null)
    }, timeoutMs)

    const unsubscribe = $editorView.subscribe(view => {
      if (view) {
        clearTimeout(timer)
        // Defer: nanostores notifies synchronously from inside set().
        setTimeout(() => unsubscribe(), 0)
        resolve(view as EditorView)
      }
    })
  })
}

/**
 * Replace the whole current document with a filled template (undoable).
 *
 * `expectedPath` is the note the caller meant. It matters because this is a
 * full-document replace sitting behind two awaits — waitForEditor alone allows
 * two seconds — and a click on another note in that window used to land the
 * template on whatever was open by then, wiping it. Callers with their own
 * awaits before this one should pass the path explicitly; the default covers
 * the rest.
 */
export async function applyTemplateToActive(
  templatePath: string,
  title: string,
  expectedPath = $activeNote.get()?.path
): Promise<void> {
  const view = await waitForEditor()

  if (!view) {
    return
  }

  const template = await vault().read(templatePath)

  if ($activeNote.get()?.path !== expectedPath) {
    return
  }

  const filled = fillTemplate(template.content, title)

  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: filled } })
  view.focus()
}

/** Open (creating if needed) today's daily note, applying Templates/Daily.md. */
export async function openDailyNote(): Promise<void> {
  const stamp = todayStamp()
  const relPath = `Daily/${stamp}.md`

  // Show the editor: from Home or the table the canvas is on another view, so
  // the editor pane isn't mounted and the note would open into nothing.
  closeTableView()

  // The template is applied with a full-document replace, so "did this note
  // already exist" has to come from the filesystem, not the $vaultNotes cache
  // — that cache is stale during the initial index and whenever the agent or
  // another device created today's note, and a wrong answer wipes real work.
  //
  // It also can't be inferred from the content: a newly created note is seeded
  // with "# Title\n\n", so a blank-content test never fires.
  const opened = await createNote(relPath)

  if (!opened?.created) {
    return
  }

  const templates = await listTemplates()
  const daily = templates.find(template => template.name.toLowerCase() === 'daily')

  if (daily) {
    await applyTemplateToActive(daily.path, stamp, relPath)
  }

  await refreshVaultNotes()
}
