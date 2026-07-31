/**
 * Meetings — record, then let the assistant turn it into a note.
 *
 * The flow is deliberately one button: name it, hit record, hit stop. The
 * recording lands in the vault as an ordinary file beside its note, the
 * transcript runs locally, and the summary is written by the agent through
 * the same vault_write everything else uses — so nothing here is a black box
 * the user can't inspect or undo.
 */

import { useStore } from '@nanostores/react'
import { useMemo, useState } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

import { $editorView } from '../vault/editor-bridge'
import { $vaultNotes, createNote, openNote } from '../vault/store'

import { $recorder, cancelRecording, formatElapsed, startRecording, stopRecording } from './recorder'
import { $productLocale, productStrings } from './strings'
import { closeTableView } from './view-store'

const MEETINGS_DIR = 'Meetings'

export function MeetingsView({ onAskAgent }: { onAskAgent?: (prompt: string) => void }) {
  const notes = useStore($vaultNotes)
  const recorder = useStore($recorder)
  const s = productStrings(useStore($productLocale))
  const [title, setTitle] = useState('')

  const meetings = useMemo(
    () =>
      notes
        .filter(note => note.path.startsWith(`${MEETINGS_DIR}/`))
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, 50),
    [notes]
  )

  const begin = async () => {
    await startRecording(title.trim())
  }

  const finish = async () => {
    const result = await stopRecording()

    if (!result) {
      return
    }

    const notePath = `${result.folder}/Notes.md`
    const heading = title.trim() || result.folder.split('/').pop() || 'Meeting'
    const created = await createNote(notePath)

    setTitle('')
    closeTableView()

    // Seed the note so it reads as a real page even before the agent answers.
    const view = $editorView.get()

    if (created?.created && view) {
      const stamp = new Date().toISOString().slice(0, 10)

      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert:
            `---\ndate: ${stamp}\nduration: ${formatElapsed(result.seconds)}\nstatus: transcribing\n---\n\n` +
            `# ${heading}\n\n> [!note] Recording\n> \`${result.audioPath}\`\n\n## Summary\n\n_Transcribing…_\n\n## Action items\n\n`
        }
      })
    }

    onAskAgent?.(
      `Transcribe the meeting recording "${result.audioPath}" with meeting_transcribe, then rewrite the note ` +
        `"${notePath}" with vault_write: keep the frontmatter but set status to done, write a short Summary ` +
        `section, a Decisions section, and an Action items section as a markdown checklist with an owner where ` +
        `one is named. Keep the recording link. Don't invent anything that wasn't said.`
    )
  }

  const busy = recorder.status === 'requesting' || recorder.status === 'saving'

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-[56rem] px-6 pb-12 pt-8">
        <h1 className="mb-5 text-[28px] font-(--dt-font-serif) font-medium tracking-[-0.01em]">{s.meetings}</h1>

        {/* Recorder. */}
        <div
          className={cn(
            'mb-6 flex flex-col gap-3 rounded-xl border p-5 transition-colors',
            recorder.status === 'recording' ? 'border-[var(--sem-late)]' : 'border-(--stroke-nous)'
          )}
        >
          {recorder.status === 'recording' ? (
            <div className="flex items-center gap-3">
              <span
                className="size-2.5 shrink-0 rounded-full bg-(--sem-late)"
                style={{ animation: 'daat-pulse 1.4s ease-in-out infinite' }}
              />
              <span className="text-[15px] font-semibold tabular-nums">{formatElapsed(recorder.elapsed)}</span>
              <span className="text-[13px] opacity-60">{s.recording}</span>

              <button
                className="ml-auto rounded-lg bg-(--dt-primary) px-3.5 py-1.5 text-[13px] font-medium text-(--dt-primary-foreground) transition-opacity hover:opacity-90"
                onClick={() => void finish()}
              >
                {s.stopAndSummarize}
              </button>
              <button
                className="rounded-lg px-2.5 py-1.5 text-[13px] opacity-60 transition-all hover:bg-(--ui-control-hover-background) hover:opacity-100"
                onClick={cancelRecording}
              >
                {s.discard}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <input
                className="min-w-0 flex-1 rounded-lg bg-(--ui-control-hover-background) px-3 py-2 text-[13.5px] outline-none placeholder:opacity-45"
                onChange={event => setTitle(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    void begin()
                  }
                }}
                placeholder={s.meetingTitlePlaceholder}
                value={title}
              />
              <button
                className="flex shrink-0 items-center gap-2 rounded-lg bg-(--dt-primary) px-3.5 py-2 text-[13px] font-medium text-(--dt-primary-foreground) transition-opacity hover:opacity-90 disabled:opacity-40"
                disabled={busy}
                onClick={() => void begin()}
              >
                <span className="size-2 rounded-full bg-white" />
                {busy ? s.loading : s.startRecording}
              </button>
            </div>
          )}

          <p className="text-[12.5px] leading-relaxed opacity-55">{s.recordingHint}</p>

          {recorder.error ? (
            <div className="flex items-start gap-2 rounded-lg bg-[var(--sem-late-wash)] px-3 py-2 text-[12.5px]">
              <Codicon className="mt-0.5 shrink-0" name="warning" />
              <span>{recorder.error}</span>
            </div>
          ) : null}
        </div>

        {/* Past meetings. */}
        {meetings.length ? (
          <div className="flex flex-col">
            {meetings.map(note => (
              <button
                className="flex items-center gap-3 border-b border-(--stroke-nous) py-2.5 text-left last:border-b-0"
                key={note.path}
                onClick={() => {
                  closeTableView()
                  void openNote(note.path)
                }}
              >
                <Codicon className="shrink-0 text-[13px] opacity-45" name="record" />
                <span className="min-w-0 flex-1 truncate text-[13.5px]">{note.title || note.path}</span>
                <span className="shrink-0 text-[11.5px] opacity-40">
                  {new Date(note.mtimeMs).toLocaleDateString()}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-(--stroke-nous) p-6 text-center text-[13px] opacity-60">
            {s.noMeetingsYet}
          </div>
        )}
      </div>
    </div>
  )
}
