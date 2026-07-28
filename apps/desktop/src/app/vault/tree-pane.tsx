/**
 * Vault tree pane: vault header, search-as-you-type (FTS5 via main), and the
 * note tree (folders derived from note paths). M1 scope — click opens a note
 * in the editor pane; new-note button; search hits replace the tree while a
 * query is active.
 */

import { useStore } from '@nanostores/react'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
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
  openNote,
  runVaultSearch
} from './store'

interface TreeEntry {
  path: string
  name: string
  kind: 'dir' | 'note'
  depth: number
}

/** Flatten note paths into a dir-first, depth-annotated render list. */
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

function EmptyVaultState() {
  const [busy, setBusy] = useState(false)

  const run = (action: () => Promise<void>) => {
    setBusy(true)
    void action().finally(() => setBusy(false))
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <Codicon name="notebook" className="text-3xl opacity-60" />
      <div className="text-sm opacity-80">Your notes live in a vault — a plain folder of markdown files.</div>
      <Button size="sm" disabled={busy} onClick={() => run(createVault)}>
        Create vault
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => run(chooseVault)}>
        Open existing folder…
      </Button>
    </div>
  )
}

export function VaultTreePane() {
  const info = useStore($vaultInfo)
  const notes = useStore($vaultNotes)
  const active = useStore($activeNote)
  const search = useStore($vaultSearch)
  const hits = useStore($vaultSearchHits)
  const indexing = useStore($vaultIndexing)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const entries = useMemo(() => buildTree(notes, collapsed), [notes, collapsed])

  if (!info?.root) {
    return <EmptyVaultState />
  }

  const newNote = () => {
    const base = 'Untitled'
    const existing = new Set(notes.map(note => note.path))
    let name = `${base}.md`

    for (let i = 2; existing.has(name); i++) {
      name = `${base} ${i}.md`
    }

    void createNote(name)
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
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 px-3 pt-2 pb-1">
        <span className="min-w-0 flex-1 truncate text-xs font-medium opacity-70">
          {info.name ?? 'Vault'} · {info.noteCount}
        </span>
        <Button size="icon-sm" variant="ghost" title="New note" onClick={newNote}>
          <Codicon name="new-file" />
        </Button>
      </div>
      <div className="px-3 pb-2">
        <input
          value={search}
          onChange={event => void runVaultSearch(event.target.value)}
          placeholder="Search notes…"
          className={cn(
            'w-full rounded-md border border-(--stroke-nous) bg-transparent px-2 py-1 text-xs',
            'outline-none placeholder:opacity-50 focus:border-(--ui-accent)'
          )}
        />
      </div>
      {indexing ? (
        <div className="px-3 pb-1 text-[10px] opacity-50">
          Indexing {indexing.indexed}/{indexing.total}…
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {search.trim() ? (
          hits.length ? (
            hits.map(hit => (
              <button
                key={hit.path}
                className={cn(
                  'block w-full px-3 py-1.5 text-left hover:bg-(--ui-control-hover-background)',
                  active?.path === hit.path && 'bg-(--ui-control-active-background)'
                )}
                onClick={() => void openNote(hit.path)}
              >
                <div className="truncate text-xs font-medium">{hit.title}</div>
                <div className="truncate text-[11px] opacity-60">{hit.snippet}</div>
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-xs opacity-50">No matches</div>
          )
        ) : (
          entries.map(entry =>
            entry.kind === 'dir' ? (
              <button
                key={entry.path}
                className="flex w-full items-center gap-1 px-3 py-0.5 text-left text-xs opacity-70 hover:bg-(--ui-control-hover-background)"
                style={{ paddingLeft: `${12 + entry.depth * 12}px` }}
                onClick={() => toggleDir(entry.path)}
              >
                <Codicon name={collapsed.has(entry.path) ? 'chevron-right' : 'chevron-down'} className="text-[10px]" />
                <Codicon name="folder" className="text-[12px]" />
                <span className="truncate">{entry.name}</span>
              </button>
            ) : (
              <button
                key={entry.path}
                className={cn(
                  'flex w-full items-center gap-1 px-3 py-0.5 text-left text-xs hover:bg-(--ui-control-hover-background)',
                  active?.path === entry.path && 'bg-(--ui-control-active-background) font-medium'
                )}
                style={{ paddingLeft: `${12 + entry.depth * 12 + 14}px` }}
                onClick={() => void openNote(entry.path)}
              >
                <Codicon name="note" className="text-[12px] opacity-60" />
                <span className="truncate">{entry.name}</span>
              </button>
            )
          )
        )}
      </div>
    </div>
  )
}
