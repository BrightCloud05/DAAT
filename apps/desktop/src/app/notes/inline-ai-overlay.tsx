/**
 * Inline AI overlay — the prompt bubble Notion shows on space: a quiet input
 * with quick actions; while running it becomes a streaming indicator with
 * Stop. Output streams directly into the document behind it.
 */

import { useStore } from '@nanostores/react'
import { useEffect, useRef, useState } from 'react'

import { Codicon } from '@/components/ui/codicon'

import { $inlineAi, closeInlineAi, runInlineAi } from './inline-ai-store'

const QUICK_ACTIONS = [
  { label: 'Continue writing', task: 'Continue writing from the cursor in the same voice and format.' },
  { label: 'Summarize page', task: 'Write a concise summary of this note.' },
  { label: '한국어로 번역', task: 'Translate the text before the cursor into natural Korean.' },
  { label: 'Translate to English', task: 'Translate the text before the cursor into natural English.' },
  { label: 'Fix grammar', task: 'Rewrite the text before the cursor with corrected grammar and clearer phrasing.' }
]

export function InlineAiOverlay() {
  const state = useStore($inlineAi)
  const [prompt, setPrompt] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (state.status === 'prompt') {
      setPrompt('')
      inputRef.current?.focus()
    }
  }, [state.status])

  if (state.status === 'idle') {
    return null
  }

  return (
    <div
      className="absolute z-30 w-[26rem] max-w-[85%] rounded-xl border border-(--stroke-nous) bg-(--dt-popover) shadow-nous"
      style={{ top: state.top, left: state.left }}
    >
      {state.status === 'prompt' ? (
        <div className="p-1.5">
          <div className="flex items-center gap-2 px-1.5">
            <Codicon name="sparkle" className="shrink-0 text-(--dt-primary)" />
            <input
              ref={inputRef}
              className="w-full bg-transparent py-1.5 text-[13px] outline-none placeholder:opacity-45"
              placeholder="Ask AI to write anything…"
              value={prompt}
              onChange={event => setPrompt(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && prompt.trim()) {
                  void runInlineAi(prompt.trim())
                }

                if (event.key === 'Escape') {
                  closeInlineAi()
                }
              }}
            />
          </div>
          {state.error ? <div className="px-2 pb-1 text-[12px] text-(--dt-destructive)">{state.error}</div> : null}
          <div className="mt-0.5 border-t border-(--stroke-nous) pt-1">
            {QUICK_ACTIONS.map(action => (
              <button
                key={action.label}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] transition-colors hover:bg-(--ui-control-hover-background)"
                onClick={() => void runInlineAi(action.task)}
              >
                <Codicon name="wand" className="text-[12px] opacity-55" />
                {action.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2">
          <Codicon name="loading" className="animate-spin text-(--dt-primary)" />
          <span className="min-w-0 flex-1 truncate text-[13px] opacity-70">Writing…</span>
          <button
            className="rounded-md px-2 py-0.5 text-[12px] opacity-60 transition-all hover:bg-(--ui-control-hover-background) hover:opacity-100"
            onClick={closeInlineAi}
          >
            Stop
          </button>
        </div>
      )}
    </div>
  )
}
