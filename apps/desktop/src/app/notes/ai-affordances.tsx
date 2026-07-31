/**
 * The two small things that make the inline assistant usable by someone who
 * did not build it:
 *
 *   · a nudge next to a selection, because ⌘I is invisible otherwise
 *   · a way back, because a rewrite destroys the user's own words and
 *     CodeMirror's history can't return them in one step
 *
 * Both are deliberately quiet — a paper-coloured chip and a text link, no
 * accent, no motion beyond the entrance.
 */

import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { Codicon } from '@/components/ui/codicon'

import { $editorView } from '../vault/editor-bridge'
import { $aiHint, $aiUndo, hideAiHint, openInlineAiAt, undoInlineAi } from './inline-ai-store'
import { $productLocale, productStrings } from './strings'

export function SelectionHint() {
  const hint = useStore($aiHint)
  const s = productStrings(useStore($productLocale))

  if (!hint.visible) {
    return null
  }

  return (
    <button
      className="absolute z-20 flex items-center gap-1.5 rounded-xs border border-(--stroke-nous) bg-(--dt-popover) px-2 py-1 text-[12px] shadow-[0_6px_20px_-14px_rgba(0,0,0,0.55)] transition-opacity hover:opacity-80"
      onMouseDown={event => {
        // mousedown, not click: a click would first collapse the selection
        // the nudge exists to act on.
        event.preventDefault()
        hideAiHint()
        openInlineAiAt(hint.to, { from: hint.from, to: hint.to })
      }}
      style={{ top: hint.top, left: hint.left, animation: 'daat-lift 140ms ease-out both' }}
      title={s.editWithAi}
    >
      <Codicon className="text-[11px] opacity-55" name="sparkle" />
      <span>{s.editWithAi}</span>
      <kbd className="ml-0.5 rounded-xs border border-(--stroke-nous) px-1 text-[10.5px] opacity-55">⌘I</kbd>
    </button>
  )
}

/** Offered after a generation, for as long as the user hasn't moved on. */
export function AiUndoBar() {
  const undo = useStore($aiUndo)
  const s = productStrings(useStore($productLocale))
  const [restored, setRestored] = useState(false)

  // Any keystroke means they have accepted it and moved on.
  useEffect(() => {
    if (!undo) {
      return
    }

    setRestored(false)

    const view = $editorView.get()

    if (!view) {
      return
    }

    const dismiss = () => $aiUndo.set(null)

    view.dom.addEventListener('beforeinput', dismiss)

    return () => view.dom.removeEventListener('beforeinput', dismiss)
  }, [undo])

  if (!undo && !restored) {
    return null
  }

  return (
    <div
      className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2.5 rounded-xs border border-(--stroke-nous) bg-(--dt-popover) px-3 py-1.5 text-[12.5px] shadow-[0_8px_26px_-18px_rgba(0,0,0,0.6)]"
      style={{ animation: 'daat-lift 160ms ease-out both' }}
    >
      {restored ? (
        <span className="opacity-60">{s.aiUndone}</span>
      ) : (
        <>
          <span className="opacity-60">{undo?.restore ? s.aiRewrote : s.aiWrote}</span>
          <button
            className="underline underline-offset-2 opacity-70 transition-opacity hover:opacity-100"
            onClick={() => {
              undoInlineAi()
              setRestored(true)
              window.setTimeout(() => setRestored(false), 1800)
            }}
          >
            {s.undo}
          </button>
        </>
      )}
    </div>
  )
}
