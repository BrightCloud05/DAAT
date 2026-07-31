/**
 * Table view — the Notion database look over the vault index: every page a
 * row, frontmatter keys as columns, string values rendered as pastel pills.
 * Read-only in v1 (cells become editable with the properties work); click a
 * title to open the page.
 */

import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

import { $vaultRevision, openNote } from '../vault/store'
import { useVirtualRows } from './virtual-rows'
import { closeTableView } from './view-store'

interface TableRow {
  path: string
  title: string
  mtimeMs: number
  props: Record<string, unknown>
}

// Tag pills — hash a value to a stable colour. The set is defined in
// styles.css so it can differ per theme; this used to inline Notion's
// pastel palette, which meant eight saturated iOS hues on paper stock.
const PILL_COLORS = [
  'var(--pill-1)',
  'var(--pill-2)',
  'var(--pill-3)',
  'var(--pill-4)',
  'var(--pill-5)',
  'var(--pill-6)',
  'var(--pill-7)',
  'var(--pill-8)'
]

function pillColor(value: string): string {
  let hash = 0

  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0
  }

  return PILL_COLORS[Math.abs(hash) % PILL_COLORS.length]
}

function CellValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  if (Array.isArray(value)) {
    return (
      <span className="flex flex-wrap gap-1">
        {value.map((item, index) => (
          <CellValue key={index} value={item} />
        ))}
      </span>
    )
  }

  if (typeof value === 'boolean') {
    return (
      <Codicon
        name={value ? 'pass-filled' : 'circle-large-outline'}
        className={value ? 'text-(--dt-primary)' : 'opacity-40'}
      />
    )
  }

  const text = String(value)

  // Short scalar strings read as select-style pills; long text stays plain.
  if (typeof value === 'string' && text.length <= 32 && !/^\d{4}-\d{2}-\d{2}/.test(text)) {
    return (
      <span
        className="inline-block max-w-full truncate rounded-md px-1.5 py-px text-[12px]"
        style={{ backgroundColor: pillColor(text) }}
      >
        {text}
      </span>
    )
  }

  return <span className="block truncate text-[12.5px] opacity-80">{text}</span>
}

function formatDate(mtimeMs: number): string {
  const date = new Date(mtimeMs)
  const pad = (n: number) => String(n).padStart(2, '0')

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Rendered row height. Must match the `py` on the cells below. */
const ROW_PX = 29

export function TableView() {
  const revision = useStore($vaultRevision)
  const [rows, setRows] = useState<TableRow[]>([])
  const [sortKey, setSortKey] = useState<string>('__modified')
  const [sortAsc, setSortAsc] = useState(false)

  // Refresh when the vault actually changed — see $vaultRevision.
  useEffect(() => {
    let cancelled = false

    void window.hermesDesktop.vault
      .propertiesTable()
      .then(data => {
        if (!cancelled) {
          setRows(data)
        }
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [revision])

  // Columns: frontmatter keys by frequency (top 8), then Modified.
  const columns = useMemo(() => {
    const counts = new Map<string, number>()

    for (const row of rows) {
      for (const key of Object.keys(row.props)) {
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }

    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([key]) => key)
  }, [rows])

  const scrollerRef = useRef<HTMLDivElement | null>(null)

  const sorted = useMemo(() => {
    const copy = [...rows]

    copy.sort((a, b) => {
      let av: unknown
      let bv: unknown

      if (sortKey === '__title') {
        av = a.title
        bv = b.title
      } else if (sortKey === '__modified') {
        av = a.mtimeMs
        bv = b.mtimeMs
      } else {
        av = a.props[sortKey]
        bv = b.props[sortKey]
      }

      if (av === bv) return 0
      if (av === undefined || av === null) return 1
      if (bv === undefined || bv === null) return -1

      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true })

      return sortAsc ? cmp : -cmp
    })

    return copy
  }, [rows, sortKey, sortAsc])

  // Only the rows on screen (plus a screenful either side, so a fast scroll
  // doesn't reach empty space before React catches up).
  const virtual = useVirtualRows(scrollerRef, sorted.length, ROW_PX)
  const windowed = sorted.slice(virtual.start, virtual.end)
  const padTop = virtual.start * ROW_PX
  const padBottom = Math.max(0, (sorted.length - virtual.end) * ROW_PX)

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortAsc(asc => !asc)
    } else {
      setSortKey(key)
      setSortAsc(key === '__title')
    }
  }

  const header = (key: string, label: string, icon?: string) => (
    <th
      key={key}
      className="cursor-pointer select-none border-b border-(--stroke-nous) px-2.5 py-1.5 text-left text-[12px] font-medium opacity-55 transition-opacity hover:opacity-90"
      onClick={() => toggleSort(key)}
    >
      <span className="flex items-center gap-1">
        {icon ? <Codicon name={icon} className="text-[11px]" /> : null}
        {label}
        {sortKey === key ? <Codicon name={sortAsc ? 'arrow-up' : 'arrow-down'} className="text-[10px]" /> : null}
      </span>
    </th>
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-baseline gap-3 px-6 pt-8 pb-3">
        <div className="mx-auto flex w-full max-w-[64rem] items-baseline gap-3">
          <h1 className="text-[1.7rem] font-bold tracking-tight">All pages</h1>
          <span className="text-xs opacity-45">{rows.length} pages</span>
          <button
            className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-[13px] opacity-60 transition-opacity hover:bg-(--ui-control-hover-background) hover:opacity-100"
            onClick={closeTableView}
          >
            <Codicon name="close" className="text-[12px]" /> Close
          </button>
        </div>
      </div>
      {/* Virtualised. Rendering every row put 160k nodes on the page and took
          five seconds to open a 10k-note vault — the table is the one screen
          that scales with the whole library rather than a slice of it.
          Rows are a fixed height, so the measurement is a multiplication and
          the scrollbar stays honest. */}
      <div className="min-h-0 flex-1 overflow-auto px-6 pb-10" ref={scrollerRef}>
        <table className="mx-auto w-full max-w-[64rem] border-separate border-spacing-0">
          <thead className="sticky top-0 z-10 bg-(--ui-bg-editor)">
            <tr>
              {header('__title', 'Name', 'note')}
              {columns.map(column => header(column, column))}
              {header('__modified', 'Modified', 'history')}
            </tr>
          </thead>
          <tbody>
            {padTop > 0 && <tr style={{ height: padTop }} aria-hidden />}
            {windowed.map(row => (
              <tr key={row.path} className="group" style={{ height: ROW_PX }}>
                <td className="max-w-[18rem] border-b border-(--stroke-nous) px-1 py-0.5">
                  <button
                    className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[13px] font-medium transition-colors hover:bg-(--ui-control-hover-background)"
                    onClick={() => {
                      closeTableView()
                      void openNote(row.path)
                    }}
                  >
                    <Codicon name="note" className="shrink-0 text-[13px] opacity-50" />
                    <span className="truncate">{row.title}</span>
                  </button>
                </td>
                {columns.map(column => (
                  <td key={column} className="max-w-[14rem] border-b border-(--stroke-nous) px-2.5 py-1 align-middle">
                    <CellValue value={row.props[column]} />
                  </td>
                ))}
                <td className="whitespace-nowrap border-b border-(--stroke-nous) px-2.5 py-1 text-[12px] opacity-55">
                  {formatDate(row.mtimeMs)}
                </td>
              </tr>
            ))}
            {padBottom > 0 && <tr style={{ height: padBottom }} aria-hidden />}
          </tbody>
        </table>
        {!sorted.length && (
          <div className="mx-auto max-w-[64rem] py-10 text-center text-sm opacity-50">
            No pages yet — create one with ⌘N.
          </div>
        )}
      </div>
    </div>
  )
}
