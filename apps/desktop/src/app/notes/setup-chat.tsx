/**
 * First-run setup screen.
 *
 * One fixed question at a time, full screen, set large. The question is a
 * local string so it appears complete and instantly — the version that had a
 * model write it revealed itself word by word, which at heading size is
 * unreadable and makes the app feel like it is struggling.
 *
 * The assistant works in the background on the answer and never speaks here.
 * Each step reports a fact and an Undo instead, which is the honest shape for
 * "just do it for me": you can always see what it made and take it back.
 */

import { useStore } from '@nanostores/react'
import { useEffect, useRef, useState } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

import type { Persona } from './personas'
import { $setup, answerQuestion, offerFilesToSetup, skipQuestion, undoStep } from './setup-agent'
import { $productLocale, productStrings } from './strings'

export function SetupChat({ persona, onDone }: { persona: Persona; onDone: () => void }) {
  const setup = useStore($setup)
  const locale = useStore($productLocale)
  const s = productStrings(locale)
  const [draft, setDraft] = useState('')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  const question = persona.questions[setup.index]
  const working = setup.status === 'working'
  const finished = setup.status === 'done'

  // A new question deserves the cursor.
  useEffect(() => {
    if (!working && !finished) {
      inputRef.current?.focus()
    }
  }, [setup.index, working, finished])

  const submit = () => {
    const text = draft.trim()

    if (!text) {
      return
    }

    setDraft('')
    void answerQuestion(persona, text)
  }

  return (
    <div
      className={cn(
        'fixed inset-0 z-(--z-onboarding) flex flex-col bg-(--theme-neutral-chrome) transition-colors',
        dragging && 'bg-[color-mix(in_srgb,var(--dt-primary)_5%,var(--theme-neutral-chrome))]'
      )}
      onDragLeave={() => setDragging(false)}
      onDragOver={event => {
        event.preventDefault()
        setDragging(true)
      }}
      onDrop={event => {
        event.preventDefault()
        setDragging(false)

        const paths = [...event.dataTransfer.files]
          .map(file => window.hermesDesktop.getPathForFile(file))
          .filter(Boolean)

        void offerFilesToSetup(persona, paths)
      }}
    >
      {/* Progress as a count, not a bar — two questions doesn't need a bar. */}
      <div className="flex shrink-0 items-center px-6 pt-5">
        {persona.questions.length > 1 && !finished ? (
          <span className="text-[12px] tabular-nums opacity-35">
            {Math.min(setup.index + 1, persona.questions.length)} / {persona.questions.length}
          </span>
        ) : null}
        <button
          className="ml-auto rounded-lg px-3 py-1.5 text-[13px] opacity-45 transition-all hover:bg-(--ui-control-hover-background) hover:opacity-90"
          onClick={onDone}
        >
          {finished ? s.openNotes : s.imDone}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6">
        <div className="flex w-full max-w-[34rem] flex-col gap-7">
          {finished ? (
            <div className="flex flex-col gap-4">
              <p className="font-(--dt-font-serif) text-[24px] leading-[1.4]">{s.setupDoneTitle}</p>
              <p className="text-[15px] leading-relaxed opacity-60">{s.setupDoneBody}</p>
              <button
                className="mt-1 self-start rounded-lg bg-(--dt-primary) px-4 py-2 text-[13.5px] font-medium text-(--dt-primary-foreground) transition-opacity hover:opacity-90"
                onClick={onDone}
              >
                {s.openNotes}
              </button>
            </div>
          ) : (
            <>
              {/* Fixed text, rendered whole. Nothing streams into this. */}
              <p className="font-(--dt-font-serif) text-[24px] leading-[1.4]" key={setup.index}>
                {locale === 'ko' ? question?.askKo : question?.ask}
              </p>

              <div className="flex flex-col gap-2.5">
                <div
                  className={cn(
                    'flex items-end gap-2 rounded-xl border px-4 py-3 transition-colors',
                    working
                      ? 'border-(--stroke-nous) opacity-50'
                      : 'border-(--stroke-nous) focus-within:border-(--dt-primary)'
                  )}
                >
                  <textarea
                    autoFocus
                    className="max-h-40 min-h-[26px] flex-1 resize-none bg-transparent text-[16px] leading-relaxed outline-none placeholder:opacity-35"
                    disabled={working}
                    onChange={event => setDraft(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        submit()
                      }
                    }}
                    placeholder={locale === 'ko' ? question?.hintKo : question?.hint}
                    ref={inputRef}
                    rows={1}
                    value={draft}
                  />
                  <button
                    className="grid size-8 shrink-0 place-items-center rounded-lg bg-(--dt-primary) text-(--dt-primary-foreground) transition-opacity hover:opacity-90 disabled:opacity-25"
                    disabled={working || !draft.trim()}
                    onClick={submit}
                    title={s.send}
                  >
                    <Codicon className="text-[14px]" name="arrow-up" />
                  </button>
                </div>

                {/* One status line, always in the same place. */}
                <div className="flex min-h-[20px] items-center gap-2 text-[12.5px]">
                  {working ? (
                    <>
                      <span
                        className="size-1.5 rounded-full bg-(--dt-primary)"
                        style={{ animation: 'daat-pulse 1.2s ease-in-out infinite' }}
                      />
                      <span className="opacity-60">{setup.activity ?? s.loading}</span>
                    </>
                  ) : (
                    <>
                      <span className="opacity-35">{s.dropAnything}</span>
                      <button
                        className="ml-auto opacity-45 underline underline-offset-2 transition-opacity hover:opacity-90"
                        onClick={() => skipQuestion(persona)}
                      >
                        {s.skipQuestion}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </>
          )}

          {setup.error ? (
            <div className="flex items-start gap-2 rounded-lg bg-(--sem-late-wash) px-3.5 py-2.5 text-[13px]">
              <Codicon className="mt-0.5 shrink-0" name="warning" />
              <span>{setup.error}</span>
            </div>
          ) : null}
        </div>
      </div>

      {/* What it made, and the way back out of each of them. */}
      <div className="flex shrink-0 justify-center px-6 pb-7">
        <div className="flex w-full max-w-[34rem] flex-col gap-1.5">
          {setup.steps.map((step, index) => {
            const kind = persona.questions[step.question]?.kind

            if (step.answer === null) {
              return null
            }

            if (kind === 'preferences') {
              return (
                <div className="flex items-center gap-2 text-[12.5px]" key={step.question}>
                  <Codicon className="shrink-0 text-[11px] text-(--dt-primary)" name="check" />
                  <span className="opacity-55">{s.savedPreference}</span>
                </div>
              )
            }

            if (!step.created.length) {
              return null
            }

            return (
              <div className="flex items-center gap-2 text-[12.5px]" key={step.question}>
                <Codicon className="shrink-0 text-[11px] text-(--dt-primary)" name="check" />
                <span className="opacity-55">{s.madePages(step.created.length)}</span>
                <button
                  className="opacity-45 underline underline-offset-2 transition-opacity hover:opacity-90"
                  onClick={() => void undoStep(index)}
                >
                  {s.undo}
                </button>
              </div>
            )
          })}
          {setup.steps.some(step => step.undone) ? (
            <span className="text-[12.5px] opacity-35">{s.undone}</span>
          ) : null}
        </div>
      </div>
    </div>
  )
}
