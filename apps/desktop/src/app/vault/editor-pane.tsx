/**
 * Vault editor pane: CodeMirror 6 hosting the active note's markdown source.
 * M1 scope — plain markdown editing with syntax highlighting, 1s-debounced
 * autosave through the store, dirty dot, and a conflict banner. Live preview
 * decorations (hide-syntax-near-cursor, wikilink widgets) land in M2 as CM
 * extensions layered onto this same host.
 */

import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { useStore } from '@nanostores/react'
import { useEffect, useRef } from 'react'

import { Codicon } from '@/components/ui/codicon'

import { foldGutter, foldKeymap } from '@codemirror/language'

import { BacklinksSection } from '../notes/backlinks-section'
import { BlockHandlesOverlay } from '../notes/block-handles-overlay'
import { InlineAiOverlay } from '../notes/inline-ai-overlay'
import { PageIcon } from '../notes/page-icon'
import { PropertiesPanel } from '../notes/properties-panel'
import { TemplateSuggestions } from '../notes/template-suggestions'

import { blockHandles } from './cm/block-handles'
import { callouts } from './cm/callouts'
import { inlineAiTrigger } from './cm/inline-ai-trigger'
import { bumpDocEpoch, setEditorView } from './editor-bridge'
import { livePreview } from './cm/live-preview'
import { markdownStyling } from './cm/markdown-style'
import { slashSource } from './cm/slash-menu'
import { vaultCompletions } from './cm/wikilink-complete'
import { wikiLinkExtension } from './cm/wikilink-language'
import { $activeDirty, $activeNote, $vaultConflicts, createNote, dismissConflict, flushActiveNote, noteEdited, openNote } from './store'

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

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
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
    lineHeight: '1.65',
    padding: '0.25rem 1.5rem 40vh'
  },
  '.cm-content': {
    maxWidth: '46rem',
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

export function VaultEditorPane() {
  const active = useStore($activeNote)
  const dirty = useStore($activeDirty)
  const conflicts = useStore($vaultConflicts)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const pathRef = useRef<string | null>(null)

  useEffect(() => {
    if (!hostRef.current) {
      return
    }

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({ doc: '' })
    })

    viewRef.current = view
    setEditorView(view)

    return () => {
      void flushActiveNote()
      setEditorView(null)
      view.destroy()
      viewRef.current = null
      pathRef.current = null
    }
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

    view.setState(
      EditorState.create({
        doc: active.content,
        extensions: [
          history(),
          inlineAiTrigger(),
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
          placeholder('Start writing…'),
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

    if (isNewNote) {
      view.focus()
    }
  }, [active])

  if (!active) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center opacity-60">
        <Codicon name="notebook" className="text-3xl" />
        <div className="text-sm">Select a note, or create one with the + button.</div>
      </div>
    )
  }

  const title = active.path.split('/').pop()?.replace(/\.(md|markdown)$/i, '') ?? active.path

  return (
    <div className="flex h-full flex-col">
      {/* Notion-style document header: emoji icon + big title (design 2a). */}
      <div className="group shrink-0 px-6 pt-9 pb-1">
        <div className="mx-auto max-w-[46rem]">
          <PageIcon />
        </div>
        <div className="mx-auto flex max-w-[46rem] items-baseline gap-3">
          <h1 className="min-w-0 flex-1 truncate text-[28px] font-bold leading-tight tracking-tight">{title}</h1>
          {active.dataless ? (
            <span className="flex items-center gap-1 text-[10px] opacity-60">
              <Codicon name="cloud-download" /> downloading from iCloud…
            </span>
          ) : null}
          <span
            className="size-1.5 shrink-0 self-center rounded-full transition-opacity"
            style={{ backgroundColor: 'var(--ui-accent)', opacity: dirty ? 1 : 0 }}
            title={dirty ? 'Unsaved changes' : 'Saved'}
          />
        </div>
      </div>
      <PropertiesPanel />
      <BacklinksSection />
      <TemplateSuggestions />
      {conflicts.map(conflict => (
        <div
          key={conflict.conflictPath}
          className="flex items-center gap-2 border-b border-(--stroke-nous) bg-(--ui-control-hover-background) px-4 py-1.5 text-xs"
        >
          <Codicon name="warning" />
          <span className="min-w-0 flex-1 truncate">
            This note changed elsewhere — your edits were saved as a conflict copy.
          </span>
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
      <div className="relative min-h-0 flex-1">
        <div ref={hostRef} className="h-full overflow-hidden" />
        <BlockHandlesOverlay />
        <InlineAiOverlay />
      </div>
    </div>
  )
}
