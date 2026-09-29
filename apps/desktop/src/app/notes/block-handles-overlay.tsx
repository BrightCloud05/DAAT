/**
 * The ＋ / ⋮⋮ block handles — Notion's second visual signature. A React
 * overlay positioned beside the hovered markdown block (geometry published
 * by the CM tracker plugin); the ⋮⋮ menu runs turn-into / duplicate /
 * move / delete as plain CM transactions.
 */

import { useStore } from '@nanostores/react'
import { useState } from 'react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Codicon } from '@/components/ui/codicon'

import {
  $hoverBlock,
  type BlockType,
  deleteBlock,
  duplicateBlock,
  insertBlockBelow,
  moveBlock,
  setOverlayHover,
  turnBlockInto
} from '../vault/cm/block-handles'
import { $editorView } from '../vault/editor-bridge'

const TURN_INTO: Array<{ type: BlockType; label: string; icon: string }> = [
  { type: 'text', label: 'Text', icon: 'symbol-text' },
  { type: 'h1', label: 'Heading 1', icon: 'symbol-numeric' },
  { type: 'h2', label: 'Heading 2', icon: 'symbol-numeric' },
  { type: 'h3', label: 'Heading 3', icon: 'symbol-numeric' },
  { type: 'bullet', label: 'Bulleted list', icon: 'list-unordered' },
  { type: 'numbered', label: 'Numbered list', icon: 'list-ordered' },
  { type: 'todo', label: 'To-do list', icon: 'checklist' },
  { type: 'quote', label: 'Quote', icon: 'quote' },
  { type: 'callout', label: 'Callout', icon: 'info' },
  { type: 'toggle', label: 'Toggle', icon: 'chevron-right' }
]

const HANDLE_BUTTON =
  'grid size-5 place-items-center rounded-md text-(--ui-text-quaternary) transition-colors hover:bg-(--ui-control-hover-background) hover:text-(--ui-text-secondary)'

export function BlockHandlesOverlay() {
  const hover = useStore($hoverBlock)
  const view = useStore($editorView)
  const [menuOpen, setMenuOpen] = useState(false)

  if (!view || (!hover && !menuOpen)) {
    return null
  }

  const block = hover

  if (!block) {
    return null
  }

  const run = (action: () => void) => {
    action()
    setMenuOpen(false)
    setOverlayHover(false)
  }

  return (
    <div
      className="absolute z-20 flex items-center gap-0.5"
      style={{ top: block.top - 1, left: Math.max(4, block.left - 52) }}
      onMouseEnter={() => setOverlayHover(true)}
      onMouseLeave={() => {
        if (!menuOpen) {
          setOverlayHover(false)
        }
      }}
    >
      <button
        className={HANDLE_BUTTON}
        title="Add block below"
        onClick={() => run(() => insertBlockBelow(view, block))}
      >
        <Codicon name="add" className="text-[13px]" />
      </button>
      <DropdownMenu
        open={menuOpen}
        onOpenChange={open => {
          setMenuOpen(open)

          if (!open) {
            setOverlayHover(false)
          }
        }}
      >
        <DropdownMenuTrigger asChild>
          <button className={HANDLE_BUTTON} title="Block options">
            <Codicon name="gripper" className="text-[13px]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom">
          <div className="px-2 py-1 text-[11px] font-medium opacity-45">Turn into</div>
          {TURN_INTO.map(item => (
            <DropdownMenuItem key={item.type} onSelect={() => run(() => turnBlockInto(view, block, item.type))}>
              <Codicon name={item.icon} className="mr-1.5 text-[12px] opacity-60" />
              {item.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => run(() => duplicateBlock(view, block))}>
            <Codicon name="copy" className="mr-1.5 text-[12px] opacity-60" /> Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run(() => moveBlock(view, block, -1))}>
            <Codicon name="arrow-up" className="mr-1.5 text-[12px] opacity-60" /> Move up
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run(() => moveBlock(view, block, 1))}>
            <Codicon name="arrow-down" className="mr-1.5 text-[12px] opacity-60" /> Move down
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => run(() => deleteBlock(view, block))}>
            <Codicon name="trash" className="mr-1.5 text-[12px] opacity-60" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
