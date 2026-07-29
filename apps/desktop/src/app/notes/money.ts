/**
 * Money model: transactions live in the vault as markdown tables, one note
 * per month (`Money/2026-07.md`). Plain files the user owns and can edit by
 * hand; the agent appends rows after extracting them from a statement.
 *
 * Row format (GFM table):
 *   | Date | Description | Category | Amount |
 *   | 2026-07-14 | Adobe | Software | -89.99 |
 *
 * Amounts are signed decimals in the vault's single currency: negative is
 * money out. Parsing tolerates $, commas, and parenthesised negatives.
 */

export interface Transaction {
  date: string
  description: string
  category: string
  amount: number
  /** Vault path of the month note this row lives in. */
  path: string
  line: number
}

export const MONEY_DIR = 'Money'
const HEADER = '| Date | Description | Category | Amount |'
const DIVIDER = '| --- | --- | --- | --- |'

export function monthNotePath(date: string): string {
  return `${MONEY_DIR}/${date.slice(0, 7)}.md`
}

export function parseAmount(raw: string): number | null {
  const text = raw.trim().replace(/[$,\s]/g, '')

  if (!text) {
    return null
  }

  const negative = /^\(.*\)$/.test(text)
  const digits = text.replace(/[()]/g, '')

  if (!/^[-+]?\d*\.?\d+$/.test(digits)) {
    return null
  }

  const value = Number(digits)

  return negative ? -Math.abs(value) : value
}

export function formatAmount(value: number, currency = '$'): string {
  const sign = value < 0 ? '-' : '+'

  return `${sign}${currency}${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Parse the transaction rows out of a month note. */
export function parseMonthNote(path: string, content: string): Transaction[] {
  const rows: Transaction[] = []
  const lines = content.split('\n')

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim()

    if (!line.startsWith('|') || line.startsWith('| ---') || /^\|\s*Date\s*\|/i.test(line)) {
      continue
    }

    const cells = line.split('|').slice(1, -1).map(cell => cell.trim())

    if (cells.length < 4) {
      continue
    }

    const [date, description, category, amountRaw] = cells
    const amount = parseAmount(amountRaw)

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || amount === null) {
      continue
    }

    rows.push({ date, description, category: category || 'Uncategorized', amount, path, line: index + 1 })
  }

  return rows
}

/** Content for a month note that doesn't exist yet. */
export function emptyMonthNote(month: string): string {
  return `---\ntype: money\nmonth: ${month}\n---\n\n# ${month}\n\n${HEADER}\n${DIVIDER}\n`
}

/**
 * Append rows to a month note's table, creating the table if needed and
 * skipping rows already present (same date + amount + description).
 */
export function appendRows(content: string, rows: Transaction[]): { content: string; added: number; skipped: number } {
  const existing = new Set(
    parseMonthNote('', content).map(row => `${row.date}|${row.amount}|${row.description.toLowerCase()}`)
  )

  let next = content

  if (!next.includes(HEADER)) {
    next = next.trimEnd() + `\n\n${HEADER}\n${DIVIDER}\n`
  }

  let added = 0
  let skipped = 0
  const lines: string[] = []

  for (const row of rows) {
    const key = `${row.date}|${row.amount}|${row.description.toLowerCase()}`

    if (existing.has(key)) {
      skipped += 1
      continue
    }

    existing.add(key)
    added += 1
    lines.push(
      `| ${row.date} | ${row.description.replace(/\|/g, '/')} | ${row.category.replace(/\|/g, '/')} | ${row.amount.toFixed(2)} |`
    )
  }

  if (lines.length) {
    next = next.trimEnd() + '\n' + lines.join('\n') + '\n'
  }

  return { content: next, added, skipped }
}

export interface MoneySummary {
  income: number
  spend: number
  net: number
  byCategory: Array<{ category: string; total: number }>
}

export function summarize(rows: Transaction[]): MoneySummary {
  let income = 0
  let spend = 0
  const categories = new Map<string, number>()

  for (const row of rows) {
    if (row.amount >= 0) {
      income += row.amount
    } else {
      spend += Math.abs(row.amount)
    }

    categories.set(row.category, (categories.get(row.category) ?? 0) + row.amount)
  }

  return {
    income,
    spend,
    net: income - spend,
    byCategory: [...categories.entries()]
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => a.total - b.total)
  }
}
