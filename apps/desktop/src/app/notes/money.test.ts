import assert from 'node:assert/strict'
import { test } from 'vitest'

import { appendRows, emptyMonthNote, monthNotePath, parseAmount, parseMonthNote, summarize } from './money'

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
