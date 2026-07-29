/**
 * Notion-style sidebar: workspace header, search, page tree with icons,
 * and bottom-anchored New page / Settings rows. Replicates Notion's visual
 * grammar (hover-revealed controls, rounded row highlights, section labels)
 * over the vault store.
 */

import { useStore } from '@nanostores/react'
import { useMemo, useState } from 'react'
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
  openNote as openNoteInStore,
  runVaultSearch
} from '../vault/store'

import { $productLocale, productStrings } from './strings'
import { $vaultTodos, initTodosStore } from './todos-store'
import {
  $canvasView,
  closeTableView,
  openCalendarView,
  openHomeView,
  openMailView,
  openMeetingsView,
  openMoneyView,
  openTableView,
  openTodoView
} from './view-store'

// Opening a page always returns the canvas to the note view.
async function openNote(relPath: string): Promise<void> {
  closeTableView()
  await openNoteInStore(relPath)
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
      name: note.path.split('/').pop()?.replace(/\.(md|markdown)$/i, '') ?? note.path,
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

const ROW = 'flex w-full items-center gap-1.5 rounded-md px-2 py-[3px] text-left text-[13px] transition-colors hover:bg-(--ui-control-hover-background)'

function newUntitled(notes: VaultNote[]): string {
  const existing = new Set(notes.map(note => note.path))
  let name = 'Untitled.md'

  for (let i = 2; existing.has(name); i++) {
    name = `Untitled ${i}.md`
  }

  return name
}

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
  const navigate = useNavigate()

  initTodosStore()

  const openTodoCount = todos.filter(todo => !todo.done).length

  const entries = useMemo(() => buildTree(notes, collapsed), [notes, collapsed])

  if (!info?.root) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
        <div className="text-[13px] opacity-75">Your notes live in a vault — a plain folder of markdown files you own.</div>
        <button
          className="rounded-md bg-(--dt-primary) px-3 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
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
    <div className="flex h-full flex-col px-2 pt-2">
      {/* Workspace header — the real mark, not a letter in a gradient box. */}
      <div className={cn(ROW, 'group mb-1')}>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[13px] font-semibold">Daat</span>
          <span className="truncate text-[11px] opacity-50">{info.name ?? 'Vault'} · {info.noteCount}</span>
        </span>
        <button
          className="opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
          onClick={() => void createNote(newUntitled(notes))}
          title="New page"
        >
          <Codicon className="text-[14px]" name="new-file" />
        </button>
      </div>

      {/* Search — Notion's quiet inline field. */}
      <div className="mb-2 flex items-center gap-1.5 rounded-md bg-(--ui-control-hover-background) px-2 py-1">
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
      <button
        className={cn(ROW, view === 'home' && 'bg-[rgba(0,122,255,0.10)] font-medium text-(--dt-primary)')}
        onClick={openHomeView}
      >
        <Codicon className="shrink-0 text-[13px] opacity-70" name="home" />
        <span>Home</span>
      </button>
      <button
        className={cn(ROW, view !== 'home' && 'bg-[rgba(0,122,255,0.10)] font-medium text-(--dt-primary)')}
        onClick={openTableView}
      >
        <Codicon className="shrink-0 text-[13px] opacity-70" name="note" />
        <span>Notes</span>
        <span className="ml-auto text-[11px] opacity-40">{notes.length}</span>
      </button>

      {/* Pages tree, nested under Notes. */}
      <div className="px-2 pb-0.5 pt-1 pl-4 text-[11px] font-medium tracking-wide opacity-45">
        {search.trim() ? 'Results' : 'Pages'}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {search.trim() ? (
          hits.length ? (
            hits.map(hit => (
              <button
                className={cn(ROW, 'flex-col items-start gap-0', active?.path === hit.path && 'bg-(--ui-control-active-background)')}
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
          entries.map(entry =>
            entry.kind === 'dir' ? (
              <button
                className={cn(ROW, 'opacity-80')}
                key={entry.path}
                onClick={() => toggleDir(entry.path)}
                style={{ paddingLeft: `${8 + entry.depth * 14}px` }}
              >
                <Codicon
                  className="shrink-0 text-[11px] opacity-55"
                  name={collapsed.has(entry.path) ? 'chevron-right' : 'chevron-down'}
                />
                <Codicon className="shrink-0 text-[13px] opacity-55" name="folder" />
                <span className="truncate">{entry.name}</span>
              </button>
            ) : (
              <button
                className={cn(
                  ROW,
                  active?.path === entry.path && 'bg-(--ui-control-active-background) font-medium'
                )}
                key={entry.path}
                onClick={() => void openNote(entry.path)}
                style={{ paddingLeft: `${8 + entry.depth * 14 + 16}px` }}
              >
                <Codicon className="shrink-0 text-[13px] opacity-55" name="note" />
                <span className="truncate">{entry.name}</span>
              </button>
            )
          )
        )}
      </div>

      {/* Module rows (design 2a): real counts where the data exists,
          quiet "soon" rows for modules not wired yet. */}
      <div className="border-t border-(--stroke-nous) pt-1.5">
        <button
          className={cn(ROW, view === 'todo' && 'bg-[rgba(0,122,255,0.10)] font-medium text-(--dt-primary)')}
          onClick={openTodoView}
        >
          <Codicon className="shrink-0 text-[13px] opacity-70" name="checklist" />
          <span>{s.todo}</span>
          <span className="ml-auto text-[11px] opacity-40">{openTodoCount || ''}</span>
        </button>
        <button
          className={cn(ROW, view === 'mail' && 'bg-[rgba(0,122,255,0.10)] font-medium text-(--dt-primary)')}
          onClick={openMailView}
        >
          <Codicon className="shrink-0 text-[13px] opacity-70" name="mail" />
          <span>{s.mail}</span>
        </button>
        <button
          className={cn(ROW, view === 'money' && 'bg-[rgba(0,122,255,0.10)] font-medium text-(--dt-primary)')}
          onClick={openMoneyView}
        >
          <Codicon className="shrink-0 text-[13px] opacity-70" name="symbol-currency" />
          <span>{s.money}</span>
        </button>
        <button
          className={cn(ROW, view === 'calendar' && 'bg-[rgba(0,122,255,0.10)] font-medium text-(--dt-primary)')}
          onClick={openCalendarView}
        >
          <Codicon className="shrink-0 text-[13px] opacity-70" name="calendar" />
          <span>{s.calendar}</span>
        </button>
        <button
          className={cn(ROW, view === 'meetings' && 'bg-[rgba(0,122,255,0.10)] font-medium text-(--dt-primary)')}
          onClick={openMeetingsView}
        >
          <Codicon className="shrink-0 text-[13px] opacity-70" name="record" />
          <span>{s.meetings}</span>
        </button>
      </div>

      {/* Bottom-anchored actions — Notion's New / Settings grammar. */}
      <div className="border-t border-(--stroke-nous) py-1.5">
        <button className={ROW} onClick={() => void createNote(newUntitled(notes))}>
          <Codicon className="text-[13px] text-(--dt-primary)" name="add" />
          <span className="text-(--dt-primary)">New page</span>
          <span className="ml-auto text-[11px] opacity-40">⌘N</span>
        </button>
        <button className={ROW} onClick={() => navigate('/settings')}>
          <Codicon className="text-[13px] opacity-55" name="settings-gear" />
          <span>Settings</span>
        </button>
      </div>
    </div>
  )
}
