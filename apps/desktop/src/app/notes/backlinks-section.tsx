/**
 * Backlinks chip under the page title — Notion's "N backlinks" affordance
 * over the vault link index. Expands into linked mentions; click opens the
 * linking page.
 */

import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { Codicon } from '@/components/ui/codicon'

import { $activeNote, $vaultNotes, openNote } from '../vault/store'

export function BacklinksSection() {
  const active = useStore($activeNote)
  const notes = useStore($vaultNotes)
  const [links, setLinks] = useState<VaultLink[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false

    if (!active) {
      setLinks([])

      return
    }

    void window.hermesDesktop.vault
      .backlinks(active.path)
      .then(result => {
        if (!cancelled) {
          setLinks(result)
        }
      })
      .catch(() => setLinks([]))

    return () => {
      cancelled = true
    }
    // notes dependency: re-query when the index changes (edits elsewhere).
  }, [active?.path, notes])

  if (!active || !links.length) {
    return null
  }

  const sources = [...new Set(links.map(link => link.source))]

  return (
    <div className="mx-auto w-full max-w-[46rem] px-6 pt-1">
      <button
        className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[12.5px] opacity-50 transition-all hover:bg-(--ui-control-hover-background) hover:opacity-85"
        onClick={() => setOpen(o => !o)}
      >
        <Codicon name={open ? 'chevron-down' : 'chevron-right'} className="text-[10px]" />
        <Codicon name="references" className="text-[12px]" />
        {sources.length} backlink{sources.length > 1 ? 's' : ''}
      </button>
      {open ? (
        <div className="mt-0.5 flex flex-col">
          {sources.map(source => (
            <button
              key={source}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-[13px] transition-colors hover:bg-(--ui-control-hover-background)"
              onClick={() => void openNote(source)}
            >
              <Codicon name="note" className="shrink-0 text-[12px] opacity-50" />
              <span className="truncate">{source.replace(/\.(md|markdown)$/i, '')}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
