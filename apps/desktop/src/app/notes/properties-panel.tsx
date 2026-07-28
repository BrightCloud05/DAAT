/**
 * Properties panel — Notion's page-property rows over the note's YAML
 * frontmatter. Edits dispatch CodeMirror transactions replacing the
 * frontmatter block, so the editor document stays the single source of
 * truth and autosave applies normally. This panel is what teaches users
 * their markdown files are structured data (and feeds the table view).
 */

import { useStore } from '@nanostores/react'
import { useState } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

import { $docEpoch, $editorView } from '../vault/editor-bridge'
import { $activeNote } from '../vault/store'
import { coerceScalar, propertyEdit, readFrontmatter } from './frontmatter'

function iconFor(key: string, value: unknown): string {
  const k = key.toLowerCase()

  if (Array.isArray(value)) return 'tag'
  if (typeof value === 'boolean') return 'check'
  if (typeof value === 'number') return 'symbol-number'
  if (k.includes('date') || k.includes('due') || /^\d{4}-\d{2}-\d{2}/.test(String(value))) return 'calendar'
  if (k.includes('url') || k.includes('link')) return 'link'
  if (k.includes('status')) return 'circle-large-outline'

  return 'symbol-text'
}

function applyProperty(key: string, value: unknown): void {
  const view = $editorView.get()

  if (!view) {
    return
  }

  const edit = propertyEdit(view.state.doc.toString(), key, value)

  view.dispatch({ changes: edit })
}

function ValueEditor({ propKey, value }: { propKey: string; value: unknown }) {
  const [draft, setDraft] = useState<string | null>(null)

  if (typeof value === 'boolean') {
    return (
      <button
        className="flex items-center"
        onClick={() => applyProperty(propKey, !value)}
        title={value ? 'Yes' : 'No'}
      >
        <Codicon
          name={value ? 'pass-filled' : 'circle-large-outline'}
          className={cn('text-[15px]', value ? 'text-(--dt-primary)' : 'opacity-40')}
        />
      </button>
    )
  }

  const display = Array.isArray(value) ? value.join(', ') : value === null || value === undefined ? '' : String(value)

  return (
    <input
      className="w-full min-w-0 rounded-md bg-transparent px-1.5 py-0.5 text-[13px] outline-none transition-colors placeholder:opacity-40 hover:bg-(--ui-control-hover-background) focus:bg-(--ui-control-hover-background)"
      placeholder="Empty"
      value={draft ?? display}
      onChange={event => setDraft(event.target.value)}
      onBlur={() => {
        if (draft === null || draft === display) {
          setDraft(null)

          return
        }

        const next = Array.isArray(value)
          ? draft
              .split(',')
              .map(part => part.trim())
              .filter(Boolean)
          : coerceScalar(draft)

        applyProperty(propKey, next)
        setDraft(null)
      }}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.currentTarget.blur()
        }

        if (event.key === 'Escape') {
          setDraft(null)
          event.currentTarget.blur()
        }
      }}
    />
  )
}

export function PropertiesPanel() {
  const active = useStore($activeNote)
  const view = useStore($editorView)

  useStore($docEpoch) // re-derive from the live doc on every edit

  // Live document wins over the store's last-saved snapshot; parsing only
  // touches the leading YAML block, so this is cheap per keystroke.
  const content = view ? view.state.doc.toString() : active?.content ?? ''
  const block = active ? readFrontmatter(content) : null
  const [adding, setAdding] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [expanded, setExpanded] = useState(true)

  if (!active) {
    return null
  }

  const props = block?.props ?? {}
  const keys = Object.keys(props)

  if (!keys.length && !adding) {
    return (
      <div className="mx-auto w-full max-w-[46rem] px-6">
        <button
          className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12.5px] opacity-45 transition-all hover:bg-(--ui-control-hover-background) hover:opacity-80"
          onClick={() => setAdding(true)}
        >
          <Codicon name="add" className="text-[12px]" /> Add a property
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[46rem] px-6 pb-1">
      {expanded &&
        keys.map(key => (
          <div key={key} className="group flex min-h-[26px] items-center gap-2">
            <span className="flex w-36 shrink-0 items-center gap-1.5 text-[13px] opacity-55">
              <Codicon name={iconFor(key, props[key])} className="text-[13px]" />
              <span className="truncate">{key}</span>
            </span>
            <div className="min-w-0 flex-1">
              <ValueEditor propKey={key} value={props[key]} />
            </div>
            <button
              className="opacity-0 transition-opacity group-hover:opacity-40 hover:!opacity-90"
              title="Remove property"
              onClick={() => applyProperty(key, undefined)}
            >
              <Codicon name="close" className="text-[11px]" />
            </button>
          </div>
        ))}

      {adding ? (
        <div className="flex min-h-[26px] items-center gap-2">
          <input
            autoFocus
            className="w-36 shrink-0 rounded-md bg-(--ui-control-hover-background) px-1.5 py-0.5 text-[13px] outline-none placeholder:opacity-40"
            placeholder="Property name"
            value={newKey}
            onChange={event => setNewKey(event.target.value)}
            onBlur={() => {
              const key = newKey.trim()

              if (key && !(key in props)) {
                applyProperty(key, '')
              }

              setAdding(false)
              setNewKey('')
            }}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.currentTarget.blur()
              }

              if (event.key === 'Escape') {
                setNewKey('')
                setAdding(false)
              }
            }}
          />
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12.5px] opacity-40 transition-all hover:bg-(--ui-control-hover-background) hover:opacity-80"
            onClick={() => setAdding(true)}
          >
            <Codicon name="add" className="text-[12px]" /> Add a property
          </button>
          {keys.length > 3 ? (
            <button
              className="text-[12px] opacity-35 hover:opacity-70"
              onClick={() => setExpanded(open => !open)}
            >
              {expanded ? 'Hide' : `Show ${keys.length}`}
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}
