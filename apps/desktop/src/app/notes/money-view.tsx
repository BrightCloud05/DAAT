/**
 * Money screen — the ledger the agent fills in. Drop a bank statement
 * (image/PDF) anywhere on this screen and BISEO extracts the transactions
 * into the month's markdown table; the table stays a plain file the user
 * can edit by hand.
 */

import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useState } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

import { $vaultNotes, openNote } from '../vault/store'
import { formatAmount, MONEY_DIR, parseMonthNote, summarize, type Transaction } from './money'
import { closeTableView } from './view-store'

const CATEGORY_TONES = [
  'rgba(255,115,105,0.22)',
  'rgba(255,159,10,0.22)',
  'rgba(255,214,10,0.26)',
  'rgba(48,209,88,0.20)',
  'rgba(100,210,255,0.22)',
  'rgba(10,132,255,0.18)',
  'rgba(191,90,242,0.20)',
  'rgba(172,142,104,0.24)'
]

function toneFor(value: string): string {
  let hash = 0

  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0
  }

  return CATEGORY_TONES[Math.abs(hash) % CATEGORY_TONES.length]
}

export function MoneyView({ onAskAgent }: { onAskAgent?: (prompt: string) => void }) {
  const notes = useStore($vaultNotes)
  const [rows, setRows] = useState<Transaction[]>([])
  const [month, setMonth] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(true)

  const months = useMemo(
    () =>
      notes
        .filter(note => note.path.startsWith(`${MONEY_DIR}/`))
        .map(note => note.path.slice(MONEY_DIR.length + 1).replace(/\.(md|markdown)$/i, ''))
        .sort()
        .reverse(),
    [notes]
  )

  const activeMonth = month ?? months[0] ?? null

  useEffect(() => {
    if (!activeMonth) {
      setRows([])
      setLoading(false)

      return
    }

    let cancelled = false

    setLoading(true)

    const relPath = `${MONEY_DIR}/${activeMonth}.md`

    void window.hermesDesktop.vault
      .read(relPath)
      .then(note => {
        if (!cancelled) {
          setRows(parseMonthNote(relPath, note.content))
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRows([])
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [activeMonth, notes])

  const totals = useMemo(() => summarize(rows), [rows])

  const importStatement = (paths: string[]) => {
    if (!paths.length || !onAskAgent) {
      return
    }

    const list = paths.map(path => `"${path}"`).join(', ')

    onAskAgent(
      `Read the bank statement file(s) ${list}. Extract every transaction as {date: YYYY-MM-DD, description, category, amount} ` +
        `with amount negative for money out, choose sensible categories, show me the table, then record them with ` +
        `money_add_transactions (source: the file name). If a file is an image, read it visually.`
    )
  }

  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-col overflow-y-auto transition-colors',
        dragging && 'bg-[color-mix(in_srgb,var(--dt-primary)_6%,transparent)]'
      )}
      onDragOver={event => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={event => {
        event.preventDefault()
        setDragging(false)

        const paths = [...event.dataTransfer.files]
          .map(file => window.hermesDesktop.getPathForFile(file))
          .filter(Boolean)

        importStatement(paths)
      }}
    >
      <div className="mx-auto w-full max-w-[56rem] px-6 pb-12 pt-8">
        <div className="mb-5 flex items-baseline gap-3">
          <h1 className="text-[28px] font-bold tracking-tight">Money</h1>
          {months.length > 1 ? (
            <select
              className="rounded-md bg-(--ui-control-hover-background) px-2 py-0.5 text-[12.5px] outline-none"
              value={activeMonth ?? ''}
              onChange={event => setMonth(event.target.value)}
            >
              {months.map(entry => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          ) : activeMonth ? (
            <span className="text-xs opacity-45">{activeMonth}</span>
          ) : null}
          {activeMonth ? (
            <button
              className="ml-auto rounded-md px-2 py-1 text-[12.5px] opacity-60 transition-all hover:bg-(--ui-control-hover-background) hover:opacity-100"
              onClick={() => {
                closeTableView()
                void openNote(`${MONEY_DIR}/${activeMonth}.md`)
              }}
            >
              Open the note
            </button>
          ) : null}
        </div>

        {/* Import zone — the differentiator, stated plainly. */}
        <div
          className={cn(
            'mb-6 flex flex-col items-center gap-1.5 rounded-xl border border-dashed px-6 py-7 text-center transition-colors',
            dragging ? 'border-(--dt-primary)' : 'border-(--stroke-nous)'
          )}
        >
          <Codicon name="cloud-upload" className="text-2xl opacity-55" />
          <div className="text-[13.5px] font-medium">Drop a bank statement here</div>
          <p className="max-w-[28rem] text-[12.5px] leading-relaxed opacity-60">
            A photo, a screenshot or a PDF. BISEO reads it, extracts every transaction, shows you the list, and files it
            into this month's note. Duplicates are skipped, so re-importing is safe.
          </p>
        </div>

        {/* Totals. */}
        {rows.length ? (
          <div className="mb-6 grid grid-cols-3 gap-4">
            {[
              { label: 'In', value: totals.income, tone: '#1F7A3D' },
              { label: 'Out', value: -totals.spend, tone: '#C0392B' },
              { label: 'Net', value: totals.net, tone: undefined }
            ].map(card => (
              <div key={card.label} className="rounded-xl border border-(--stroke-nous) p-4">
                <div className="text-[12px] opacity-50">{card.label}</div>
                <div className="mt-0.5 text-[19px] font-semibold" style={card.tone ? { color: card.tone } : undefined}>
                  {formatAmount(card.value)}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {/* Transactions. */}
        {loading ? (
          <div className="text-[13px] opacity-50">Loading…</div>
        ) : rows.length ? (
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr>
                {['Date', 'Description', 'Category', 'Amount'].map(head => (
                  <th
                    key={head}
                    className={cn(
                      'border-b border-(--stroke-nous) px-2.5 py-1.5 text-left text-[12px] font-medium opacity-55',
                      head === 'Amount' && 'text-right'
                    )}
                  >
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().map(row => (
                <tr key={`${row.date}-${row.line}`}>
                  <td className="whitespace-nowrap border-b border-(--stroke-nous) px-2.5 py-1.5 text-[12.5px] opacity-70">
                    {row.date}
                  </td>
                  <td className="max-w-[22rem] truncate border-b border-(--stroke-nous) px-2.5 py-1.5 text-[13px]">
                    {row.description}
                  </td>
                  <td className="border-b border-(--stroke-nous) px-2.5 py-1.5">
                    <span
                      className="inline-block rounded-md px-1.5 py-px text-[12px]"
                      style={{ backgroundColor: toneFor(row.category) }}
                    >
                      {row.category}
                    </span>
                  </td>
                  <td
                    className="whitespace-nowrap border-b border-(--stroke-nous) px-2.5 py-1.5 text-right text-[13px] font-medium"
                    style={{ color: row.amount >= 0 ? '#1F7A3D' : undefined }}
                  >
                    {formatAmount(row.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="rounded-xl border border-(--stroke-nous) p-6 text-center text-[13px] opacity-60">
            No transactions yet for this month.
          </div>
        )}

        {/* Category breakdown. */}
        {totals.byCategory.length ? (
          <div className="mt-6">
            <div className="mb-2 text-[13px] font-semibold">By category</div>
            <div className="flex flex-col gap-1.5">
              {totals.byCategory.map(entry => (
                <div key={entry.category} className="flex items-center gap-2 text-[13px]">
                  <span
                    className="inline-block rounded-md px-1.5 py-px text-[12px]"
                    style={{ backgroundColor: toneFor(entry.category) }}
                  >
                    {entry.category}
                  </span>
                  <span className="ml-auto font-medium" style={{ color: entry.total >= 0 ? '#1F7A3D' : undefined }}>
                    {formatAmount(entry.total)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
