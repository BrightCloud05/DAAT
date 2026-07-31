import assert from 'node:assert/strict'
import { test } from 'vitest'

import { appendRows, emptyMonthNote, monthNotePath, parseAmount, parseMonthNote, summarize } from './money'
import type { Transaction } from './money'

test('amounts parse from the shapes statements actually use', () => {
  assert.equal(parseAmount('-89.99'), -89.99)
  assert.equal(parseAmount('$1,200.50'), 1200.5)
  assert.equal(parseAmount('(45.00)'), -45)
  assert.equal(parseAmount('  12 '), 12)
  assert.equal(parseAmount('n/a'), null)
  assert.equal(parseAmount(''), null)
})

test('month notes round-trip through parse and append', () => {
  const path = monthNotePath('2026-07-14')

  assert.equal(path, 'Money/2026-07.md')

  const first = appendRows(emptyMonthNote('2026-07'), [
    { date: '2026-07-14', description: 'Adobe', category: 'Software', amount: -89.99, path, line: 0 },
    { date: '2026-07-15', description: 'Marlow Co', category: 'Income', amount: 4200, path, line: 0 }
  ])

  assert.equal(first.added, 2)
  assert.equal(first.skipped, 0)

  const rows = parseMonthNote(path, first.content)

  assert.equal(rows.length, 2)
  assert.equal(rows[0].description, 'Adobe')
  assert.equal(rows[0].amount, -89.99)

  // Re-importing the same statement adds nothing.
  const second = appendRows(first.content, rows)

  assert.equal(second.added, 0)
  assert.equal(second.skipped, 2)
})

test('parse ignores the header, divider and malformed rows', () => {
  const content = [
    '| Date | Description | Category | Amount |',
    '| --- | --- | --- | --- |',
    '| 2026-07-01 | Good | Cat | -1.00 |',
    '| not-a-date | Bad | Cat | -1.00 |',
    '| 2026-07-02 | Bad amount | Cat | n/a |',
    'plain text line'
  ].join('\n')

  const rows = parseMonthNote('Money/2026-07.md', content)

  assert.equal(rows.length, 1)
  assert.equal(rows[0].description, 'Good')
})

test('pipes in descriptions cannot break the table', () => {
  const path = 'Money/2026-07.md'
  const { content } = appendRows(emptyMonthNote('2026-07'), [
    { date: '2026-07-03', description: 'A | B', category: 'X | Y', amount: -5, path, line: 0 }
  ])

  const rows = parseMonthNote(path, content)

  assert.equal(rows.length, 1)
  assert.equal(rows[0].description, 'A / B')
  assert.equal(rows[0].amount, -5)
})

test('summary splits in/out and totals categories', () => {
  const path = 'Money/2026-07.md'
  const totals = summarize([
    { date: '2026-07-01', description: 'a', category: 'Software', amount: -50, path, line: 1 },
    { date: '2026-07-02', description: 'b', category: 'Software', amount: -25, path, line: 2 },
    { date: '2026-07-03', description: 'c', category: 'Income', amount: 300, path, line: 3 }
  ])

  assert.equal(totals.income, 300)
  assert.equal(totals.spend, 75)
  assert.equal(totals.net, 225)
  assert.deepEqual(totals.byCategory, [
    { category: 'Software', total: -75 },
    { category: 'Income', total: 300 }
  ])
})

test('two identical purchases on one day both land', () => {
  // A statement really can contain the same date, amount and description
  // twice. Deduping on presence dropped the second one and called it a
  // duplicate, so the month's spend came out short with no warning.
  const rows: Transaction[] = [
    { date: '2026-07-31', description: 'Coffee', category: 'Food', amount: -4.5, path: '', line: 0 },
    { date: '2026-07-31', description: 'Coffee', category: 'Food', amount: -4.5, path: '', line: 0 }
  ]

  const result = appendRows(emptyMonthNote('2026-07'), rows)

  assert.equal(result.added, 2)
  assert.equal(result.skipped, 0)
  assert.equal(summarize(parseMonthNote('m.md', result.content)).spend, 9)
})

test('re-importing the same statement still adds nothing', () => {
  const rows: Transaction[] = [
    { date: '2026-07-31', description: 'Coffee', category: 'Food', amount: -4.5, path: '', line: 0 },
    { date: '2026-07-31', description: 'Coffee', category: 'Food', amount: -4.5, path: '', line: 0 },
    { date: '2026-07-30', description: 'Rent', category: 'Housing', amount: -1800, path: '', line: 0 }
  ]

  const once = appendRows(emptyMonthNote('2026-07'), rows)
  const twice = appendRows(once.content, rows)

  assert.equal(twice.added, 0, 'a second import of the same statement must be a no-op')
  assert.equal(twice.skipped, 3)
  assert.equal(summarize(parseMonthNote('m.md', twice.content)).spend, 1809)
})

test('a partly-overlapping statement adds only what is new', () => {
  const first: Transaction[] = [
    { date: '2026-07-31', description: 'Coffee', category: 'Food', amount: -4.5, path: '', line: 0 }
  ]
  const second: Transaction[] = [
    { date: '2026-07-31', description: 'Coffee', category: 'Food', amount: -4.5, path: '', line: 0 },
    { date: '2026-07-31', description: 'Coffee', category: 'Food', amount: -4.5, path: '', line: 0 }
  ]

  const start = appendRows(emptyMonthNote('2026-07'), first)
  const result = appendRows(start.content, second)

  assert.equal(result.added, 1, 'the note held one coffee; the statement shows two')
  assert.equal(result.skipped, 1)
})
