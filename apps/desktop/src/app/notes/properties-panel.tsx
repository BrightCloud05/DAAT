/**
 * Properties panel — Notion's page-property rows over the note's YAML
 * frontmatter. Edits dispatch CodeMirror transactions replacing the
 * frontmatter block, so the editor document stays the single source of
 * truth and autosave applies normally. This panel is what teaches users
 * their markdown files are structured data (and feeds the table view).
 */

import { useStore } from '@nanostores/react'
import { useRef, useState } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

import { $docEpoch, $editorView } from '../vault/editor-bridge'
import { $activeNote } from '../vault/store'

import { coerceScalar, propertyEdit, readFrontmatter } from './frontmatter'
import { $productLocale, productStrings } from './strings'

/** Frontmatter blocks past this are pathological; don't scan the whole note. */
const FRONTMATTER_SCAN_CHARS = 8192

function iconFor(key: string, value: unknown): string {
  const k = key.toLowerCase()

  if (Array.isArray(value)) {return 'tag'}

  if (typeof value === 'boolean') {return 'check'}

  if (typeof value === 'number') {return 'symbol-number'}

  if (k.includes('date') || k.includes('due') || /^\d{4}-\d{2}-\d{2}/.test(String(value))) {return 'calendar'}

  if (k.includes('url') || k.includes('link')) {return 'link'}

  if (k.includes('status')) {return 'circle-large-outline'}

  return 'symbol-text'
}

function applyProperty(key: string, value: unknown): void {
  const view = $editorView.get()

  if (!view) {
    return
  }

  const edit = propertyEdit(view.state.doc.toString(), key, value)

  // null means "this block must not be rewritten" (malformed or non-map YAML).
  if (edit) {
    view.dispatch({ changes: edit })
  }
}

function ValueEditor({ propKey, value }: { propKey: string; value: unknown }) {
  const [draft, setDraft] = useState<string | null>(null)
  const cancelled = useRef(false)
  const s = productStrings(useStore($productLocale))

  if (typeof value === 'boolean') {
    return (
      <button
        aria-label={propKey}
        aria-pressed={value}
        className="flex items-center"
        onClick={() => applyProperty(propKey, !value)}
        title={value ? s.yes : s.no}
      >
        <Codicon
          className={cn('text-[15px]', value ? 'text-(--dt-primary)' : 'opacity-40')}
          name={value ? 'pass-filled' : 'circle-large-outline'}
        />
      </button>
    )
  }

  // Nested YAML (or an unsubstituted `{{template}}` placeholder, which YAML
  // reads as a map) must never render as "[object Object]" — show the source.
  const display = Array.isArray(value)
    ? value.map(item => (item && typeof item === 'object' ? JSON.stringify(item) : String(item))).join(', ')
    : value === null || value === undefined
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value)

  return (
    <input
      aria-label={propKey}
      className="w-full min-w-0 rounded-md bg-transparent px-1.5 py-0.5 text-[13px] outline-none transition-colors placeholder:opacity-40 hover:bg-(--ui-control-hover-background) focus:bg-(--ui-control-hover-background)"
      onBlur={() => {
        if (cancelled.current) {
          cancelled.current = false
          setDraft(null)

          return
        }

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
      onChange={event => setDraft(event.target.value)}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) {return}

        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.currentTarget.blur()
        }

        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          cancelled.current = true
          setDraft(null)
          event.currentTarget.blur()
        }
      }}
      placeholder={s.emptyValue}
      value={draft ?? display}
    />
  )
}

export function PropertiesPanel() {
  const active = useStore($activeNote)
  const s = productStrings(useStore($productLocale))
  const cancelAdding = useRef(false)
  const view = useStore($editorView)

  useStore($docEpoch) // re-derive from the live doc on every edit

  // Live document wins over the store's last-saved snapshot. Only the leading
  // YAML block is ever read, so slice the head rather than materializing a
  // whole (possibly multi-megabyte) note on every keystroke.
  const content = view ? view.state.doc.sliceString(0, FRONTMATTER_SCAN_CHARS) : (active?.content ?? '')
  const block = active ? readFrontmatter(content) : null
  const [adding, setAdding] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [expanded, setExpanded] = useState(true)

  if (!active) {
    return null
  }

  const props = block?.props ?? {}
  const keys = Object.keys(props)

  // Broken YAML: say so. Rendering "Add a property" here hid the problem —
  // the raw block is folded out of the editor, so the user had no way to see
  // that their properties were unreadable, let alone fix them.
  if (block && block.kind !== 'ok') {
    return (
      <div className="mx-auto w-full max-w-[46rem] px-6">
        <div className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12.5px] opacity-60">
          <Codicon className="text-[12px]" name="warning" />
          {block.kind === 'invalid' ? s.invalidYaml : s.notAPropertyList}
        </div>
      </div>
    )
  }

  if (!keys.length && !adding) {
    return (
      <div className="mx-auto w-full max-w-[46rem] px-6">
        <button
          className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12.5px] opacity-45 transition-all hover:bg-(--ui-control-hover-background) hover:opacity-80"
          onClick={() => setAdding(true)}
        >
          <Codicon className="text-[12px]" name="add" /> {s.addProperty}
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[46rem] px-6 pb-1">
      {expanded &&
        keys.map(key => (
          <div className="group flex min-h-[26px] items-center gap-2" key={`${active.path}:${key}`}>
            <span className="flex w-36 shrink-0 items-center gap-1.5 text-[13px] opacity-55">
              <Codicon className="text-[13px]" name={iconFor(key, props[key])} />
              <span className="truncate">{key}</span>
            </span>
            <div className="min-w-0 flex-1">
              <ValueEditor propKey={key} value={props[key]} />
            </div>
            <button
              aria-label={`${s.removeProperty}: ${key}`}
              className="opacity-0 transition-opacity group-hover:opacity-40 focus-visible:opacity-100 hover:!opacity-90"
              onClick={() => applyProperty(key, undefined)}
              title={s.removeProperty}
            >
              <Codicon className="text-[11px]" name="close" />
            </button>
          </div>
        ))}

      {adding ? (
        <div className="flex min-h-[26px] items-center gap-2">
          <input
            aria-label={s.propertyName}
            autoFocus
            className="w-36 shrink-0 rounded-md bg-(--ui-control-hover-background) px-1.5 py-0.5 text-[13px] outline-none placeholder:opacity-40"
            onBlur={() => {
              if (cancelAdding.current) {
                cancelAdding.current = false
                setAdding(false)
                setNewKey('')

                return
              }

              const key = newKey.trim()

              if (key && !(key in props)) {
                applyProperty(key, '')
              }

              setAdding(false)
              setNewKey('')
            }}
            onChange={event => setNewKey(event.target.value)}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing) {return}

              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.currentTarget.blur()
              }

              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                cancelAdding.current = true
                setNewKey('')
                setAdding(false)
              }
            }}
            placeholder={s.propertyName}
            value={newKey}
          />
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12.5px] opacity-40 transition-all hover:bg-(--ui-control-hover-background) hover:opacity-80"
            onClick={() => setAdding(true)}
          >
            <Codicon className="text-[12px]" name="add" /> {s.addProperty}
          </button>
          {keys.length > 3 ? (
            <button className="text-[12px] opacity-35 hover:opacity-70" onClick={() => setExpanded(open => !open)}>
              {expanded ? s.hide : `${s.show} ${keys.length}`}
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}
