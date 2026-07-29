/**
 * Page emoji icon (design 2a): a 44px emoji above the title, stored as the
 * `icon` frontmatter property so it round-trips as plain markdown and shows
 * up in the table view like any other property.
 */

import { useStore } from '@nanostores/react'
import { useRef, useState } from 'react'

import { $docEpoch, $editorView } from '../vault/editor-bridge'
import { $activeNote } from '../vault/store'
import { propertyEdit, readFrontmatter } from './frontmatter'

export function PageIcon() {
  const active = useStore($activeNote)
  const view = useStore($editorView)
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useStore($docEpoch)

  if (!active) {
    return null
  }

  const content = view ? view.state.doc.toString() : active.content
  const icon = String(readFrontmatter(content)?.props.icon ?? '').trim()

  const setIcon = (value: string) => {
    const target = $editorView.get()

    if (!target) {
      return
    }

    const edit = propertyEdit(target.state.doc.toString(), 'icon', value.trim() || undefined)

    // null when the note's YAML is malformed — better no icon than a rewritten
    // block that buries the user's broken frontmatter under a second one.
    if (edit) {
      target.dispatch({ changes: edit })
    }

    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        autoFocus
        defaultValue={icon}
        placeholder="🚀"
        className="mb-2 w-16 rounded-lg bg-(--ui-control-hover-background) px-2 py-1 text-[32px] leading-none outline-none"
        onBlur={event => setIcon(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.currentTarget.blur()
          }

          if (event.key === 'Escape') {
            setEditing(false)
          }
        }}
      />
    )
  }

  if (icon) {
    return (
      <button
        className="mb-2 rounded-lg text-[44px] leading-none transition-colors hover:bg-(--ui-control-hover-background)"
        title="Change icon"
        onClick={() => setEditing(true)}
      >
        {icon}
      </button>
    )
  }

  return (
    <button
      className="mb-1 rounded-md px-1.5 py-0.5 text-[12.5px] opacity-0 transition-opacity hover:bg-(--ui-control-hover-background) focus:opacity-70 [.group:hover_&]:opacity-45 hover:!opacity-80"
      onClick={() => setEditing(true)}
    >
      + Add icon
    </button>
  )
}
