/**
 * Notion-style sidebar: workspace header, search, page tree with icons,
 * and bottom-anchored New page / Settings rows. Replicates Notion's visual
 * grammar (hover-revealed controls, rounded row highlights, section labels)
 * over the vault store.
 */

import { useStore } from '@nanostores/react'
import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

import {
  $activeNote,
  $vaultIndexing,
  $vaultInfo,
  $vaultNotes,
  $vaultSearch,
  $vaultSearchHits,
  chooseVault,
  createNote,
  createVault,
  deleteNote,
  newUntitledPath,
  openNote as openNoteInStore,
  renameNote,
  runVaultSearch
} from '../vault/store'

import { $productLocale, productStrings } from './strings'
import { $vaultTodos, initTodosStore } from './todos-store'
import {
  $canvasView,
  closeTableView,
  openAutomationsView,
  openCalendarView,
  openCapabilities,
  openCatSettings,
  openGraphView,
  openHomeView,
  openMailView,
  openMeetingsView,
  openTableView,
  openTodoView
} from './view-store'
import { useVirtualRows } from './virtual-rows'

// Opening a page always returns the canvas to the note view.
async function openNote(relPath: string): Promise<void> {
  closeTableView()
  await openNoteInStore(relPath)
}

/**
 * Making a page is opening a page.
 *
 * createNote adopts the new note as active but does not touch the canvas, so
 * pressing New page from Graph, Todo or the table left the user on that screen
 * with nothing visibly different. The note existed; it was simply not on
 * screen. People pressed it again — which is where the `Untitled 2`,
 * `Untitled 3` trail in real vaults comes from.
 */
async function createPage(relPath: string): Promise<void> {
  closeTableView()
  await createNote(relPath)
}

interface TreeEntry {
  path: string
  name: string
  kind: 'dir' | 'note'
  depth: number
}

function buildTree(notes: VaultNote[], collapsed: Set<string>): TreeEntry[] {
  const dirs = new Set<string>()

  for (const note of notes) {
    const parts = note.path.split('/')

    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join('/'))
    }
  }

  const entries: TreeEntry[] = [
    ...[...dirs].map(dir => ({
      path: dir,
      name: dir.split('/').pop() ?? dir,
      kind: 'dir' as const,
      depth: dir.split('/').length - 1
    })),
    ...notes.map(note => ({
      path: note.path,
      name:
        note.path
          .split('/')
          .pop()
          ?.replace(/\.(md|markdown)$/i, '') ?? note.path,
      kind: 'note' as const,
      depth: note.path.split('/').length - 1
    }))
  ]

  entries.sort((a, b) => a.path.localeCompare(b.path))

  return entries.filter(entry => {
    const parent = entry.path.split('/').slice(0, -1).join('/')

    for (let dir = parent; dir; dir = dir.split('/').slice(0, -1).join('/')) {
      if (collapsed.has(dir)) {
        return false
      }
    }

    return true
  })
}

const ROW =
  'flex w-full items-center gap-2 rounded-xs px-2.5 py-[5px] text-left text-[13px] transition-colors hover:bg-(--ui-control-hover-background)'

/**
 * Selected state. Deliberately NOT a coloured pill — these rows used to carry
 * a hard-coded `rgba(0,122,255,0.10)`, which meant the sidebar stayed Apple
 * blue no matter which skin was active. Selection now reads the way it does on
 * paper: the ink goes full strength and the weight steps up, over a fill that
 * is just the page a shade darker.
 */
const ROW_ON = 'bg-(--ui-control-active-background) font-medium text-(--ui-text-primary)'

/** Group label above a list — small, spaced, and quiet. */
const GROUP = 'px-2.5 pb-1 pt-4 text-[10px] font-medium uppercase tracking-[0.09em] opacity-40'

/** Fixed tree-row height, pinned so the windowing maths stays exact. */
const TREE_ROW_PX = 26

export function NotesSidebar() {
  const s = productStrings(useStore($productLocale))
  const info = useStore($vaultInfo)
  const notes = useStore($vaultNotes)
  const active = useStore($activeNote)
  const search = useStore($vaultSearch)
  const hits = useStore($vaultSearchHits)
  const indexing = useStore($vaultIndexing)
  const view = useStore($canvasView)
  const todos = useStore($vaultTodos)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const commitRename = async (fromPath: string) => {
    setRenaming(null)

    const clean = renameDraft.trim().replace(/[/\\]/g, ' ')
    const dir = fromPath.split('/').slice(0, -1).join('/')
    const ext = /\.(md|markdown)$/i.exec(fromPath)?.[0] ?? '.md'
    const toPath = (dir ? `${dir}/` : '') + clean + ext

    if (!clean || toPath === fromPath) {
      return
    }

    try {
      await renameNote(fromPath, toPath)
    } catch {
      // Target exists or the volume said no — the note keeps its old name.
    }
  }

  const removeNote = async (relPath: string, name: string) => {
    if (!window.confirm(s.deleteConfirm(name))) {
      return
    }

    try {
      await deleteNote(relPath)
    } catch {
      // Already gone (other Mac, external editor) — the refresh sorts it out.
    }
  }

  const navigate = useNavigate()

  initTodosStore()

  const openTodoCount = todos.filter(todo => !todo.done).length

  const treeRef = useRef<HTMLDivElement | null>(null)
  const entries = useMemo(() => buildTree(notes, collapsed), [notes, collapsed])

  // Only the rows on screen. A leading spacer carries the height of what is
  // scrolled past, so the scrollbar still reports the real depth of the tree.
  const treeWindow = useVirtualRows(treeRef, entries.length, TREE_ROW_PX)
  const visibleEntries = entries.slice(treeWindow.start, treeWindow.end)

  if (!info?.root) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
        <div className="text-[13px] opacity-75">
          Your notes live in a vault — a plain folder of markdown files you own.
        </div>
        <button
          className="rounded-md bg-(--dt-primary) px-3 py-1.5 text-[13px] font-medium text-(--dt-primary-foreground) transition-opacity hover:opacity-90"
          onClick={() => void createVault()}
        >
          Create my vault
        </button>
        <button className="text-xs opacity-60 underline hover:opacity-90" onClick={() => void chooseVault()}>
          Open existing folder…
        </button>
      </div>
    )
  }

  const toggleDir = (path: string) => {
    const next = new Set(collapsed)

    if (next.has(path)) {
      next.delete(path)
    } else {
      next.add(path)
    }

    setCollapsed(next)
  }

  return (
    <div className="flex h-full flex-col px-2 pt-3">
      {/* Workspace header — the real mark, not a letter in a gradient box. */}
      <div className={cn(ROW, 'group mb-3')}>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[13px] font-semibold">Daat</span>
          <span className="truncate text-[11px] opacity-50">
            {info.name ?? 'Vault'} · {info.noteCount}
          </span>
        </span>
        <button
          className="opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
          onClick={() => void createPage(newUntitledPath(notes))}
          title="New page"
        >
          <Codicon className="text-[14px]" name="new-file" />
        </button>
      </div>

      {/* Search — Notion's quiet inline field. */}
      <div className="mb-1 flex items-center gap-2 rounded-xs bg-(--ui-control-hover-background) px-2.5 py-1.5">
        <Codicon className="shrink-0 text-[12px] opacity-50" name="search" />
        <input
          className="w-full bg-transparent text-[13px] outline-none placeholder:opacity-50"
          onChange={event => void runVaultSearch(event.target.value)}
          placeholder={s.search}
          value={search}
        />
        {search ? (
          <button className="opacity-50 hover:opacity-90" onClick={() => void runVaultSearch('')}>
            <Codicon className="text-[11px]" name="close" />
          </button>
        ) : null}
      </div>

      {indexing ? (
        <div className="px-2 pb-1 text-[10px] opacity-45">
          Indexing {indexing.indexed}/{indexing.total}…
        </div>
      ) : null}

      {/* Module nav (design 2a): Home, Notes(+tree), then the module rows. */}
      <button className={cn(ROW, view === 'home' && ROW_ON)} onClick={openHomeView}>
        <Codicon className="shrink-0 text-[13px] opacity-70" name="home" />
        <span>Home</span>
      </button>
      <button className={cn(ROW, view !== 'home' && ROW_ON)} onClick={openTableView}>
        <Codicon className="shrink-0 text-[13px] opacity-70" name="note" />
        <span>Notes</span>
        <span className="ml-auto text-[11px] opacity-40">{notes.length}</span>
      </button>

      {/* Pages tree, nested under Notes. */}
      <div className={GROUP}>{search.trim() ? 'Results' : 'Pages'}</div>
      {/* The tree is windowed for the same reason the table is: a large vault
          put every note in the DOM at once. Search results are not — that list
          is already capped, and its rows are two lines tall rather than a
          fixed height. */}
      <div className="min-h-0 flex-1 overflow-y-auto pb-2" ref={treeRef}>
        {search.trim() ? (
          hits.length ? (
            hits.map(hit => (
              <button
                className={cn(
                  ROW,
                  'flex-col items-start gap-0',
                  active?.path === hit.path && 'bg-(--ui-control-active-background)'
                )}
                key={hit.path}
                onClick={() => void openNote(hit.path)}
              >
                <span className="flex w-full items-center gap-1.5">
                  <Codicon className="shrink-0 text-[13px] opacity-55" name="note" />
                  <span className="truncate font-medium">{hit.title}</span>
                </span>
                <span className="w-full truncate pl-[22px] text-[11px] opacity-55">{hit.snippet}</span>
              </button>
            ))
          ) : (
            <div className="px-2 py-2 text-xs opacity-50">No matches</div>
          )
        ) : (
          [
            treeWindow.start > 0 ? (
              <div aria-hidden key="__pad" style={{ height: treeWindow.start * TREE_ROW_PX }} />
            ) : null,
            ...visibleEntries.map(entry =>
              entry.kind === 'dir' ? (
                <button
                  className={cn(ROW, 'opacity-80')}
                  key={entry.path}
                  onClick={() => toggleDir(entry.path)}
                  style={{ height: TREE_ROW_PX, paddingLeft: `${8 + entry.depth * 14}px` }}
                >
                  <Codicon
                    className="shrink-0 text-[11px] opacity-55"
                    name={collapsed.has(entry.path) ? 'chevron-right' : 'chevron-down'}
                  />
                  <Codicon className="shrink-0 text-[13px] opacity-55" name="folder" />
                  <span className="truncate">{entry.name}</span>
                </button>
              ) : renaming === entry.path ? (
                <div
                  className={cn(ROW)}
                  key={entry.path}
                  style={{ height: TREE_ROW_PX, paddingLeft: `${8 + entry.depth * 14 + 16}px` }}
                >
                  <Codicon className="shrink-0 text-[13px] opacity-55" name="note" />
                  <input
                    autoFocus
                    className="w-full min-w-0 border-b border-(--dt-primary) bg-transparent text-[13px] outline-none"
                    onBlur={() => void commitRename(entry.path)}
                    onChange={event => setRenameDraft(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                        event.currentTarget.blur()
                      } else if (event.key === 'Escape') {
                        setRenaming(null)
                      }
                    }}
                    value={renameDraft}
                  />
                </div>
              ) : (
                // Hover-revealed rename/delete, following the sidebar's Notion
                // grammar. A wrapper div because buttons cannot nest.
                <div className="group/note relative" key={entry.path} style={{ height: TREE_ROW_PX }}>
                  <button
                    className={cn(
                      ROW,
                      'h-full',
                      active?.path === entry.path && 'bg-(--ui-control-active-background) font-medium'
                    )}
                    onClick={() => void openNote(entry.path)}
                    style={{ height: TREE_ROW_PX, paddingLeft: `${8 + entry.depth * 14 + 16}px` }}
                  >
                    <Codicon className="shrink-0 text-[13px] opacity-55" name="note" />
                    <span className="truncate">{entry.name}</span>
                  </button>
                  <div className="absolute right-1 top-1/2 hidden -translate-y-1/2 items-center gap-px rounded-sm bg-(--ui-control-hover-background) group-hover/note:flex">
                    <button
                      className="grid size-[20px] place-items-center rounded-sm opacity-60 hover:opacity-100"
                      onClick={() => {
                        setRenaming(entry.path)
                        setRenameDraft(entry.name)
                      }}
                      title={s.renameNote}
                    >
                      <Codicon className="text-[12px]" name="edit" />
                    </button>
                    <button
                      className="grid size-[20px] place-items-center rounded-sm opacity-60 hover:opacity-100"
                      onClick={() => void removeNote(entry.path, entry.name)}
                      title={s.deleteNoteAction}
                    >
                      <Codicon className="text-[12px]" name="trash" />
                    </button>
                  </div>
                </div>
              )
            )
          ]
        )}
        {!search.trim() && treeWindow.end < entries.length ? (
          <div aria-hidden style={{ height: (entries.length - treeWindow.end) * TREE_ROW_PX }} />
        ) : null}
      </div>

      {/* Module rows (design 2a): real counts where the data exists,
          quiet "soon" rows for modules not wired yet. */}
      <div className="mt-2 border-t border-(--stroke-nous) pt-2">
        <button className={cn(ROW, view === 'graph' && ROW_ON)} onClick={openGraphView}>
          <Codicon className="shrink-0 text-[13px] opacity-70" name="type-hierarchy-sub" />
          <span>{s.graph}</span>
        </button>
        <button className={cn(ROW, view === 'todo' && ROW_ON)} onClick={openTodoView}>
          <Codicon className="shrink-0 text-[13px] opacity-70" name="checklist" />
          <span>{s.todo}</span>
          <span className="ml-auto text-[11px] opacity-40">{openTodoCount || ''}</span>
        </button>
        <button className={cn(ROW, view === 'mail' && ROW_ON)} onClick={openMailView}>
          <Codicon className="shrink-0 text-[13px] opacity-70" name="mail" />
          <span>{s.mail}</span>
        </button>
        <button className={cn(ROW, view === 'automations' && ROW_ON)} onClick={openAutomationsView}>
          <Codicon className="shrink-0 text-[13px] opacity-70" name="watch" />
          <span>{s.automations}</span>
        </button>
        <button className={cn(ROW, view === 'calendar' && ROW_ON)} onClick={openCalendarView}>
          <Codicon className="shrink-0 text-[13px] opacity-70" name="calendar" />
          <span>{s.calendar}</span>
        </button>
        <button className={cn(ROW, view === 'meetings' && ROW_ON)} onClick={openMeetingsView}>
          <Codicon className="shrink-0 text-[13px] opacity-70" name="record" />
          <span>{s.meetings}</span>
        </button>
      </div>

      {/* Bottom-anchored actions — Notion's New / Settings grammar. */}
      <div className="mt-2 border-t border-(--stroke-nous) py-2">
        <button className={ROW} onClick={() => void createPage(newUntitledPath(notes))}>
          <Codicon className="text-[13px] opacity-55" name="add" />
          <span>{s.newPage}</span>
          <span className="ml-auto text-[11px] opacity-40">⌘N</span>
        </button>
        <button className={cn(ROW, view === 'cat' && ROW_ON)} onClick={openCatSettings}>
          <Codicon className="text-[13px] opacity-55" name="smiley" />
          <span>{s.catSettings}</span>
        </button>
        <button className={ROW} onClick={openCapabilities}>
          <Codicon className="text-[13px] opacity-55" name="extensions" />
          <span>{s.hermesFeatures}</span>
        </button>
        <button className={ROW} onClick={() => navigate('/settings')}>
          <Codicon className="text-[13px] opacity-55" name="settings-gear" />
          <span>{s.settings}</span>
        </button>
      </div>
    </div>
  )
}
