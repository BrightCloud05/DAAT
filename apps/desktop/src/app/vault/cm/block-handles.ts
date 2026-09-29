/**
 * Block handles support: tracks which markdown block the pointer is over and
 * publishes its geometry so the React overlay can draw Notion's ＋ / ⋮⋮
 * controls beside it. Block operations (turn-into, duplicate, move, delete)
 * are plain line-range transactions on the markdown buffer — files change
 * only where the user acts (drag-free v1, per the adoption plan).
 */

import { syntaxTree } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import { atom } from 'nanostores'

export interface HoverBlock {
  from: number
  to: number
  /** Top/left of the block's first line, relative to the editor host. */
  top: number
  left: number
}

export const $hoverBlock = atom<HoverBlock | null>(null)

/** Top-level markdown block containing pos (paragraph, heading, list, quote…). */
export function blockRangeAt(view: EditorView, pos: number): { from: number; to: number } | null {
  const tree = syntaxTree(view.state)
  let node = tree.resolveInner(pos, 1)

  while (node.parent && node.parent.name !== 'Document') {
    node = node.parent
  }

  if (node.name === 'Document') {
    const line = view.state.doc.lineAt(pos)

    return line.length ? { from: line.from, to: line.to } : null
  }

  // Frontmatter is chrome, not a block the user rearranges.
  if (node.name === 'Frontmatter' || (node.from === 0 && view.state.doc.sliceString(0, 3) === '---')) {
    const text = view.state.doc.sliceString(node.from, Math.min(node.from + 3, node.to))

    if (text === '---' && node.from === 0) {
      return null
    }
  }

  return { from: node.from, to: node.to }
}

const trackerPlugin = ViewPlugin.fromClass(
  class {
    constructor(private view: EditorView) {
      view.dom.addEventListener('mousemove', this.onMove)
      view.dom.addEventListener('mouseleave', this.onLeave)
      view.scrollDOM.addEventListener('scroll', this.onLeave, { passive: true })
    }

    onMove = (event: MouseEvent) => {
      const pos = this.view.posAtCoords({ x: event.clientX, y: event.clientY })

      if (pos === null) {
        return
      }

      const block = blockRangeAt(this.view, pos)

      if (!block) {
        $hoverBlock.set(null)

        return
      }

      const current = $hoverBlock.get()

      if (current && current.from === block.from && current.to === block.to) {
        return
      }

      const coords = this.view.coordsAtPos(block.from)

      if (!coords) {
        return
      }

      const host = this.view.dom.getBoundingClientRect()

      $hoverBlock.set({
        from: block.from,
        to: block.to,
        top: coords.top - host.top,
        left: coords.left - host.left
      })
    }

    onLeave = () => {
      // The overlay re-arms hover while the pointer is over the handles
      // themselves; a plain leave clears after a beat.
      window.setTimeout(() => {
        if (!overlayHover) {
          $hoverBlock.set(null)
        }
      }, 120)
    }

    update() {
      // Doc/viewport changes invalidate the cached geometry.
      $hoverBlock.set(null)
    }

    destroy() {
      this.view.dom.removeEventListener('mousemove', this.onMove)
      this.view.dom.removeEventListener('mouseleave', this.onLeave)
      this.view.scrollDOM.removeEventListener('scroll', this.onLeave)
      $hoverBlock.set(null)
    }
  }
)

let overlayHover = false

export function setOverlayHover(hovering: boolean): void {
  overlayHover = hovering

  if (!hovering) {
    $hoverBlock.set(null)
  }
}

export function blockHandles(): Extension {
  return trackerPlugin
}

// ---------------------------------------------------------------------------
// Block operations — all pure line-range transactions.
// ---------------------------------------------------------------------------

const PREFIX_RE = /^(#{1,6}\s+|>\s?(\[!\w+\]-?\s?)?|[-*]\s\[[ xX]\]\s+|[-*]\s+|\d+[.)]\s+)/

export type BlockType =
  | 'text'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bullet'
  | 'numbered'
  | 'todo'
  | 'quote'
  | 'callout'
  | 'toggle'

const PREFIXES: Record<BlockType, string> = {
  text: '',
  h1: '# ',
  h2: '## ',
  h3: '### ',
  bullet: '- ',
  numbered: '1. ',
  todo: '- [ ] ',
  quote: '> ',
  callout: '> [!note] ',
  toggle: '> [!note]- '
}

/** Rewrite every line of the block with the target prefix. */
export function turnBlockInto(view: EditorView, block: { from: number; to: number }, type: BlockType): void {
  const doc = view.state.doc
  const firstLine = doc.lineAt(block.from)
  const lastLine = doc.lineAt(block.to)
  const changes = []

  for (let lineNo = firstLine.number; lineNo <= lastLine.number; lineNo++) {
    const line = doc.line(lineNo)
    const stripped = line.text.replace(PREFIX_RE, '')
    // Only the first line of a callout/toggle carries the marker.
    const prefix = (type === 'callout' || type === 'toggle') && lineNo > firstLine.number ? '> ' : PREFIXES[type]

    changes.push({ from: line.from, to: line.to, insert: prefix + stripped })
  }

  view.dispatch({ changes })
}

export function duplicateBlock(view: EditorView, block: { from: number; to: number }): void {
  const text = view.state.doc.sliceString(block.from, block.to)

  view.dispatch({ changes: { from: block.to, insert: `\n${text}` } })
}

export function deleteBlock(view: EditorView, block: { from: number; to: number }): void {
  const doc = view.state.doc
  const to = Math.min(block.to + 1, doc.length) // eat the trailing newline

  view.dispatch({ changes: { from: block.from, to, insert: '' } })
}

export function moveBlock(view: EditorView, block: { from: number; to: number }, dir: -1 | 1): void {
  const doc = view.state.doc
  const neighborPos = dir === -1 ? block.from - 2 : block.to + 2

  if (neighborPos < 0 || neighborPos > doc.length) {
    return
  }

  const neighbor = blockRangeAt(view, Math.max(0, Math.min(neighborPos, doc.length)))

  if (!neighbor || (neighbor.from === block.from && neighbor.to === block.to)) {
    return
  }

  const blockText = doc.sliceString(block.from, block.to)
  const neighborText = doc.sliceString(neighbor.from, neighbor.to)
  const [first, second] = block.from < neighbor.from ? [block, neighbor] : [neighbor, block]
  const [firstText, secondText] =
    block.from < neighbor.from ? [neighborText, blockText] : [blockText, neighborText]

  view.dispatch({
    changes: [
      { from: first.from, to: first.to, insert: firstText },
      { from: second.from, to: second.to, insert: secondText }
    ]
  })
}

/** Insert an empty block below and open the slash menu there. */
export function insertBlockBelow(view: EditorView, block: { from: number; to: number }): void {
  view.dispatch({
    changes: { from: block.to, insert: '\n' },
    selection: { anchor: block.to + 1 }
  })
  view.focus()
}
