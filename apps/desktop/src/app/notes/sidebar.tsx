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
import { closeTableView, openTableView } from './view-store'

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
  const info = useStore($vaultInfo)
  const notes = useStore($vaultNotes)
  const active = useStore($activeNote)
  const search = useStore($vaultSearch)
  const hits = useStore($vaultSearchHits)
  const indexing = useStore($vaultIndexing)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const navigate = useNavigate()

  const entries = useMemo(() => buildTree(notes, collapsed), [notes, collapsed])

  if (!info?.root) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
        <div className="grid size-10 place-items-center rounded-xl bg-(--dt-primary) text-lg font-bold text-white">B</div>
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
      {/* Workspace header — Notion's identity row. */}
      <div className={cn(ROW, 'group mb-1 font-medium')}>
        <span className="grid size-5 shrink-0 place-items-center rounded-[6px] bg-(--dt-primary) text-[11px] font-bold text-white">
          B
        </span>
        <span className="min-w-0 flex-1 truncate">{info.name ?? 'Vault'}</span>
        <button
          className="opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
          title="New page"
          onClick={() => void createNote(newUntitled(notes))}
        >
          <Codicon name="new-file" className="text-[14px]" />
        </button>
      </div>

      {/* Search — Notion's quiet inline field. */}
      <div className="mb-2 flex items-center gap-1.5 rounded-md bg-(--ui-control-hover-background) px-2 py-1">
        <Codicon name="search" className="shrink-0 text-[12px] opacity-50" />
        <input
          value={search}
          onChange={event => void runVaultSearch(event.target.value)}
          placeholder="Search"
          className="w-full bg-transparent text-[13px] outline-none placeholder:opacity-50"
        />
        {search ? (
          <button className="opacity-50 hover:opacity-90" onClick={() => void runVaultSearch('')}>
            <Codicon name="close" className="text-[11px]" />
          </button>
        ) : null}
      </div>

      {indexing ? (
        <div className="px-2 pb-1 text-[10px] opacity-45">
          Indexing {indexing.indexed}/{indexing.total}…
        </div>
      ) : null}

      {/* Views. */}
      <button className={ROW} onClick={openTableView}>
        <Codicon name="table" className="shrink-0 text-[13px] opacity-55" />
        <span>All pages</span>
      </button>

      {/* Pages. */}
      <div className="px-2 pb-1 pt-1 text-[11px] font-medium tracking-wide opacity-45">
        {search.trim() ? 'Results' : 'Pages'}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {search.trim() ? (
          hits.length ? (
            hits.map(hit => (
              <button
                key={hit.path}
                className={cn(ROW, 'flex-col items-start gap-0', active?.path === hit.path && 'bg-(--ui-control-active-background)')}
                onClick={() => void openNote(hit.path)}
              >
                <span className="flex w-full items-center gap-1.5">
                  <Codicon name="note" className="shrink-0 text-[13px] opacity-55" />
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
                key={entry.path}
                className={cn(ROW, 'opacity-80')}
                style={{ paddingLeft: `${8 + entry.depth * 14}px` }}
                onClick={() => toggleDir(entry.path)}
              >
                <Codicon
                  name={collapsed.has(entry.path) ? 'chevron-right' : 'chevron-down'}
                  className="shrink-0 text-[11px] opacity-55"
                />
                <Codicon name="folder" className="shrink-0 text-[13px] opacity-55" />
                <span className="truncate">{entry.name}</span>
              </button>
            ) : (
              <button
                key={entry.path}
                className={cn(
                  ROW,
                  active?.path === entry.path && 'bg-(--ui-control-active-background) font-medium'
                )}
                style={{ paddingLeft: `${8 + entry.depth * 14 + 16}px` }}
                onClick={() => void openNote(entry.path)}
              >
                <Codicon name="note" className="shrink-0 text-[13px] opacity-55" />
                <span className="truncate">{entry.name}</span>
              </button>
            )
          )
        )}
      </div>

      {/* Bottom-anchored actions — Notion's New / Settings grammar. */}
      <div className="border-t border-(--stroke-nous) py-1.5">
        <button className={ROW} onClick={() => void createNote(newUntitled(notes))}>
          <Codicon name="add" className="text-[13px] opacity-55" />
          <span>New page</span>
          <span className="ml-auto text-[11px] opacity-40">⌘N</span>
        </button>
        <button className={ROW} onClick={() => navigate('/settings')}>
          <Codicon name="settings-gear" className="text-[13px] opacity-55" />
          <span>Settings</span>
        </button>
      </div>
    </div>
  )
}
