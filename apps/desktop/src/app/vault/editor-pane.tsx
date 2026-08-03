/**
 * Vault editor pane: CodeMirror 6 hosting the active note's markdown source.
 * M1 scope — plain markdown editing with syntax highlighting, 1s-debounced
 * autosave through the store, dirty dot, and a conflict banner. Live preview
 * decorations (hide-syntax-near-cursor, wikilink widgets) land in M2 as CM
 * extensions layered onto this same host.
 */

import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { foldGutter, foldKeymap } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Codicon } from '@/components/ui/codicon'

import { AiUndoBar, SelectionHint } from '../notes/ai-affordances'
import { BacklinksSection } from '../notes/backlinks-section'
import { BlockHandlesOverlay } from '../notes/block-handles-overlay'
import { InlineAiOverlay } from '../notes/inline-ai-overlay'
import { PageIcon } from '../notes/page-icon'
import { PropertiesPanel } from '../notes/properties-panel'
import { $productLocale, productStrings } from '../notes/strings'
import { TemplateSuggestions } from '../notes/template-suggestions'
import { openDailyNote } from '../notes/templates'

import { blockHandles } from './cm/block-handles'
import { callouts } from './cm/callouts'
import { inlineAiTrigger } from './cm/inline-ai-trigger'
import { livePreview } from './cm/live-preview'
import { markdownStyling } from './cm/markdown-style'
import { selectionHint } from './cm/selection-hint'
import { slashSource } from './cm/slash-menu'
import { vaultCompletions } from './cm/wikilink-complete'
import { wikiLinkExtension } from './cm/wikilink-language'
import { bumpDocEpoch, setEditorView } from './editor-bridge'
import {
  $activeDirty,
  $activeNote,
  $vaultConflicts,
  $vaultNotes,
  $vaultSaveError,
  createNote,
  dismissConflict,
  flushActiveNote,
  newUntitledPath,
  noteEdited,
  openNote
} from './store'

async function openWikilink(target: string): Promise<void> {
  const resolved = await window.hermesDesktop.vault.resolveWikilink(target)

  if (resolved) {
    await openNote(resolved)
  } else {
    // Unresolved link: create the note — the Obsidian "links make pages"
    // behavior that also matches Notion's instant page creation.
    await createNote(target)
  }
}

/**
 * Reading measure. 46rem ran to roughly 95 characters a line — comfortable for
 * a code editor, tiring for prose. 38rem lands near 70, which is the width
 * reMarkable and most typographers settle on. The title block below shares the
 * constant so the heading can never sit wider than the text it titles.
 */
const MEASURE = '38rem'

const editorTheme = EditorView.theme({
  '&': {
    // Grow with the document instead of filling the pane.
    //
    // height:100% made CodeMirror its own scroll container, which is why the
    // title and the properties could never scroll away: they were fixed flex
    // items above a box that scrolled by itself. On a page with eight
    // properties that header ate a third of the window and never gave it back.
    //
    // Letting the editor size to its content hands the scrolling to the pane,
    // so title, properties, backlinks and body move together — one document,
    // the way Notion reads.
    height: 'auto',
    // Design 2a: body copy 14px / 1.65.
    fontSize: '14px',
    backgroundColor: 'transparent'
  },
  // Fold gutter: invisible chrome — chevrons surface on hover only, the
  // Notion "controls appear when you reach for them" stance.
  '.cm-gutters': {
    backgroundColor: 'transparent',
    border: 'none',
    color: 'var(--ui-text-quaternary)'
  },
  '.cm-foldGutter .cm-gutterElement': {
    opacity: 0,
    transition: 'opacity 150ms ease-out',
    cursor: 'pointer',
    padding: '0 0.2rem'
  },
  '&:hover .cm-foldGutter .cm-gutterElement': { opacity: 0.7 },
  '.cm-foldPlaceholder': {
    background: 'color-mix(in srgb, var(--dt-primary) 8%, transparent)',
    border: 'none',
    borderRadius: '4px',
    color: 'var(--ui-text-tertiary)',
    padding: '0 0.4rem',
    margin: '0 0.2rem'
  },
  // Completion popup rides the app's soft elevation.
  '.cm-tooltip.cm-tooltip-autocomplete': {
    borderRadius: '10px',
    border: '1px solid var(--stroke-nous)',
    boxShadow: 'var(--shadow-nous)',
    backgroundColor: 'var(--dt-popover)',
    overflow: 'hidden'
  },
  '.cm-tooltip-autocomplete ul li': {
    padding: '0.3rem 0.6rem'
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    background: 'color-mix(in srgb, var(--dt-primary) 12%, transparent)',
    color: 'inherit'
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: '1.7',
    padding: '0.25rem 2.5rem 40vh',
    // The base theme sets overflow-x:auto, and a box that scrolls on one axis
    // silently becomes a scroll container on both — which would quietly put the
    // inner scrollbar back and undo the height:auto above. Lines wrap, so there
    // is no horizontal overflow to preserve.
    overflow: 'visible'
  },
  '.cm-content': {
    maxWidth: MEASURE,
    margin: '0 auto',
    caretColor: 'var(--ui-accent)'
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-line': { padding: '0 2px' },
  '.cm-cursor': { borderLeftColor: 'var(--ui-accent)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--ui-accent) 22%, transparent)'
  }
})

/** First offset after a leading `---` block, or 0. */
function bodyStart(content: string): number {
  const match = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(content)

  return match ? Math.min(match[0].length, content.length) : 0
}

export function VaultEditorPane() {
  const s = productStrings(useStore($productLocale))
  const active = useStore($activeNote)
  const dirty = useStore($activeDirty)
  const conflicts = useStore($vaultConflicts)
  const saveError = useStore($vaultSaveError)
  const viewRef = useRef<EditorView | null>(null)
  const pathRef = useRef<string | null>(null)
  const [hostReady, setHostReady] = useState(0)

  // Callback ref, NOT a mount effect: the host div only exists while a note is
  // open, so an effect with [] deps would run once against a null ref and no
  // editor would ever be created (the "nothing is editable" bug). A callback
  // ref fires exactly when the node attaches/detaches, whatever the render
  // path, and the bump makes the doc effect re-run against the fresh view.
  const attachHost = useCallback((node: HTMLDivElement | null) => {
    if (!node) {
      void flushActiveNote()
      setEditorView(null)
      viewRef.current?.destroy()
      viewRef.current = null
      pathRef.current = null

      return
    }

    if (viewRef.current) {
      return
    }

    const view = new EditorView({ parent: node, state: EditorState.create({ doc: '' }) })

    viewRef.current = view
    setEditorView(view)
    setHostReady(value => value + 1)
  }, [])

  useEffect(() => {
    const view = viewRef.current

    if (!view || !active) {
      return
    }

    const isNewNote = pathRef.current !== active.path
    const currentDoc = view.state.doc.toString()

    // External refresh of the same note only applies when it truly differs
    // (the store already guards on dirty state).
    if (!isNewNote && currentDoc === active.content) {
      return
    }

    pathRef.current = active.path

    // Same note, new text from disk: patch the document instead of replacing
    // the state. setState() destroys every plugin, drops undo history and
    // resets the cursor to 0 — which the user sees as the caret jumping to the
    // top of the file mid-sentence whenever a save round-trips.
    if (!isNewNote) {
      // The editor is ahead of the store: a save that started before the last
      // few keystrokes has just published the text it wrote. Replacing the
      // document with it would rewind the user's sentence on screen and, via
      // the update listener, mark it clean — losing it for good.
      if ($activeDirty.get()) {
        return
      }

      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: active.content },
        selection: { anchor: Math.min(view.state.selection.main.anchor, active.content.length) },
        scrollIntoView: false
      })

      return
    }

    view.setState(
      EditorState.create({
        doc: active.content,
        // Start in the body, past any frontmatter: offset 0 sits inside the
        // YAML block, which keeps it unfolded and drops the user into
        // metadata instead of their writing.
        selection: { anchor: bodyStart(active.content) },
        extensions: [
          history(),
          inlineAiTrigger(),
          selectionHint(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [wikiLinkExtension] }),
          markdownStyling,
          livePreview({ openWikilink: target => void openWikilink(target) }),
          callouts(),
          blockHandles(),
          vaultCompletions([slashSource]),
          keymap.of(foldKeymap),
          foldGutter({
            openText: '▾',
            closedText: '▸',
            domEventHandlers: {}
          }),
          EditorView.lineWrapping,
          placeholder(s.startWriting),
          editorTheme,
          EditorView.updateListener.of(update => {
            if (update.docChanged) {
              noteEdited(update.state.doc.toString())
              bumpDocEpoch()
            }

            // Keep the agent's current-note context fresh: the active note and
            // any selection, throttled to selection/doc changes only.
            if (update.selectionSet || update.docChanged) {
              const { from, to } = update.state.selection.main

              window.hermesDesktop.vault.reportContext({
                activeNote: pathRef.current,
                selection: from === to ? '' : update.state.doc.sliceString(from, to)
              })
            }
          })
        ]
      })
    )

    view.focus()
  }, [active, hostReady])

  if (!active) {
    return (
      /* An empty screen is still a screen. This used to be a large glyph over
         one dimmed line, which tells the user nothing they can act on — so
         it now says what to do and offers the page they were most likely
         about to make. No icon: a giant notebook mark is the same species as
         the logo we took out everywhere else. */
      <div className="flex h-full flex-col items-center justify-center bg-(--ui-bg-sidebar) px-8">
        <div className="w-full max-w-[24rem]">
          <p className="m-0 font-(--dt-font-serif) text-[22px] leading-snug">{s.emptyEditorTitle}</p>
          <p className="mt-2 mb-0 text-[13.5px] leading-relaxed opacity-55">{s.emptyEditorBody}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              className="rounded-xs bg-(--dt-primary) px-3.5 py-1.5 text-[13px] font-medium text-(--dt-primary-foreground) transition-opacity hover:opacity-85"
              onClick={() => void openDailyNote()}
            >
              {s.openTodaysPage}
            </button>
            <button
              className="rounded-xs border border-(--stroke-nous) px-3.5 py-1.5 text-[13px] transition-colors hover:bg-(--ui-control-hover-background)"
              onClick={() => void createNote(newUntitledPath($vaultNotes.get()))}
            >
              {s.newPage}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const title =
    active.path
      .split('/')
      .pop()
      ?.replace(/\.(md|markdown)$/i, '') ?? active.path

  return (
    /**
     * A sheet of paper on a desk, not a wall of colour edge to edge.
     *
     * Painted as a background gradient rather than a wrapper element: the
     * sheet has to run the full height behind both the title block and the
     * scrolling editor, and those are siblings. A real element would have to
     * be positioned behind both and would fight CodeMirror for the scroll.
     * Two hairline stops give it its edges.
     */
    <div
      className="relative h-full bg-(--ui-bg-sidebar)"
      style={{
        backgroundImage:
          'linear-gradient(to right,' +
          ' transparent 0 calc(50% - var(--sheet-w) / 2),' +
          ' var(--stroke-nous) calc(50% - var(--sheet-w) / 2) calc(50% - var(--sheet-w) / 2 + 1px),' +
          ' var(--dt-card) calc(50% - var(--sheet-w) / 2 + 1px) calc(50% + var(--sheet-w) / 2 - 1px),' +
          ' var(--stroke-nous) calc(50% + var(--sheet-w) / 2 - 1px) calc(50% + var(--sheet-w) / 2),' +
          ' transparent calc(50% + var(--sheet-w) / 2))'
      }}
    >
      {/* One scroll for the whole page. Title, properties, backlinks and body
          are a single document that scrolls together, so a note with a long
          property list gives all of that room back as soon as you scroll. */}
      <div className="h-full overflow-y-auto">
        {/* Notion-style document header: emoji icon + big title (design 2a). */}
        <div className="group shrink-0 px-10 pt-16 pb-2">
          <div className="mx-auto max-w-[38rem]">
            <PageIcon />
          </div>
          <div className="mx-auto flex max-w-[38rem] items-baseline gap-3">
            <h1 className="min-w-0 flex-1 truncate text-[28px] font-(--dt-font-serif) font-medium leading-tight tracking-[-0.01em]">
              {title}
            </h1>
            {active.dataless ? (
              <span className="flex items-center gap-1 text-[10px] opacity-60">
                <Codicon name="cloud-download" /> {s.downloadingFromICloud}
              </span>
            ) : null}
            <span
              className="size-1.5 shrink-0 self-center rounded-full transition-opacity"
              style={{ backgroundColor: 'var(--ui-accent)', opacity: dirty ? 1 : 0 }}
              title={dirty ? s.unsavedChanges : s.saved}
            />
          </div>
        </div>
        <PropertiesPanel />
        <BacklinksSection />
        <TemplateSuggestions />

        {/* A save that keeps failing must be visible. The text is still in the
          editor and still being retried, but silence here is how people lose
          an afternoon's writing to a full disk or an offline volume. */}
        {saveError ? (
          <div className="flex items-center gap-2 border-b border-(--stroke-nous) bg-(--sem-late-wash) px-4 py-1.5 text-xs">
            <Codicon name="warning" />
            <span className="min-w-0 flex-1 truncate">{s.saveFailed(saveError)}</span>
            <button className="underline opacity-80 hover:opacity-100" onClick={() => void flushActiveNote()}>
              {s.retryNow}
            </button>
          </div>
        ) : null}

        {conflicts.map(conflict => (
          <div
            className="flex items-center gap-2 border-b border-(--stroke-nous) bg-(--ui-control-hover-background) px-4 py-1.5 text-xs"
            key={conflict.conflictPath}
          >
            <Codicon name="warning" />
            <span className="min-w-0 flex-1 truncate">{s.conflictNotice}</span>
            <button
              className="underline opacity-80 hover:opacity-100"
              onClick={() => {
                void openNote(conflict.conflictPath)
                dismissConflict(conflict.conflictPath)
              }}
            >
              Open copy
            </button>
            <button className="opacity-60 hover:opacity-100" onClick={() => dismissConflict(conflict.conflictPath)}>
              <Codicon name="close" />
            </button>
          </div>
        ))}
        {/* The editor sizes to its content; the pane above owns the scrolling.
          These overlays place themselves against the editor's own box, so
          living inside it means they travel with the text instead of drifting
          away from the line they point at. */}
        <div className="relative">
          <div ref={attachHost} />
          <BlockHandlesOverlay />
          <SelectionHint />
          <InlineAiOverlay />
        </div>
      </div>

      {/* Outside the scroller on purpose: "undo that rewrite" is only useful
          where the eye already is. Inside, `bottom` would mean the bottom of a
          document that may be thousands of lines long. */}
      <AiUndoBar />
    </div>
  )
}
