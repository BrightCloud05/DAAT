/**
 * Template chips on an empty page — Notion's "start with a template"
 * affordance. Shown only while the document is effectively blank (nothing
 * but an optional title line); one click replaces the page with the filled
 * template (a single undoable CM transaction).
 */

import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { Codicon } from '@/components/ui/codicon'

import { $docEpoch, $editorView } from '../vault/editor-bridge'
import { $activeNote } from '../vault/store'
import { applyTemplateToActive, listTemplates, type TemplateInfo } from './templates'

function isBlankDoc(text: string): boolean {
  return /^(#[^\n]*)?\s*$/.test(text)
}

export function TemplateSuggestions() {
  const active = useStore($activeNote)
  const view = useStore($editorView)
  const [templates, setTemplates] = useState<TemplateInfo[]>([])

  useStore($docEpoch)

  useEffect(() => {
    void listTemplates().then(setTemplates)
  }, [active?.path])

  if (!active || !view || active.path.startsWith('Templates/')) {
    return null
  }

  if (!isBlankDoc(view.state.doc.toString()) || !templates.length) {
    return null
  }

  const title = active.path.split('/').pop()?.replace(/\.(md|markdown)$/i, '') ?? ''

  return (
    <div className="mx-auto w-full max-w-[46rem] px-6 pt-2">
      <div className="mb-1.5 text-[12px] opacity-40">
        Press <kbd className="rounded bg-(--ui-control-hover-background) px-1">/</kbd> for blocks, or start with a
        template:
      </div>
      <div className="flex flex-wrap gap-1.5">
        {templates.map(template => (
          <button
            key={template.path}
            className="flex items-center gap-1.5 rounded-lg border border-(--stroke-nous) px-2.5 py-1 text-[13px] transition-colors hover:bg-(--ui-control-hover-background)"
            onClick={() => void applyTemplateToActive(template.path, title)}
          >
            <Codicon name="file" className="text-[12px] opacity-55" />
            {template.name}
          </button>
        ))}
      </div>
    </div>
  )
}
