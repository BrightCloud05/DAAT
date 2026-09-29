import assert from 'node:assert/strict'
import { test } from 'vitest'

import { collectEntries, dateFromValue, monthGrid, stampOf } from './calendar'

test('dates are read from the shapes frontmatter actually holds', () => {
  assert.equal(dateFromValue('2026-07-29'), '2026-07-29')
  assert.equal(dateFromValue('2026-07-29T10:30:00Z'), '2026-07-29')
  assert.equal(dateFromValue(new Date(2026, 6, 29)), '2026-07-29')
  assert.equal(dateFromValue('  2026-07-29  '), '2026-07-29')
  assert.equal(dateFromValue('next tuesday'), null)
  assert.equal(dateFromValue(undefined), null)
  assert.equal(dateFromValue(['2026-07-29']), null)
  // Out-of-range values would render in a month the user never picked.
  assert.equal(dateFromValue('2026-13-01'), null)
  assert.equal(dateFromValue('2026-07-40'), null)
})

test('the month grid is Sunday-first and covers the whole month', () => {
  // July 2026 starts on a Wednesday and has 31 days.
  const weeks = monthGrid(2026, 6, '2026-07-29')

  assert.equal(weeks[0].length, 7)
  assert.equal(weeks[0][0].date, '2026-06-28', 'leading days come from June')
  assert.equal(weeks[0][3].date, '2026-07-01')
  assert.equal(weeks[0][3].inMonth, true)
  assert.equal(weeks[0][0].inMonth, false)

  const inMonth = weeks.flat().filter(cell => cell.inMonth)

  assert.equal(inMonth.length, 31)
  assert.equal(inMonth.at(-1)!.date, '2026-07-31')
  assert.equal(weeks.flat().filter(cell => cell.isToday).length, 1)
})

test('a month that fits in five rows does not render a sixth', () => {
  // February 2026 starts on a Sunday: exactly four weeks.
  const weeks = monthGrid(2026, 1, '2026-07-29')

  assert.ok(weeks.length <= 5, `expected at most 5 rows, got ${weeks.length}`)
  assert.equal(weeks.flat().filter(cell => cell.inMonth).length, 28)
})

test('stamps use local time, not UTC', () => {
  // A late-evening date must not roll into tomorrow for users east of UTC.
  assert.equal(stampOf(new Date(2026, 6, 29, 23, 30)), '2026-07-29')
})

test('entries come from daily notes, dated notes and due tasks', () => {
  const entries = collectEntries(
    [
      { path: 'Daily/2026-07-29.md', title: '2026-07-29', props: { date: '2026-07-29' } },
      { path: 'Projects/Launch.md', title: 'Launch', props: { due: '2026-07-30' } },
      { path: 'Notes/Idea.md', title: 'Idea', props: {} }
    ],
    [
      { path: 'Daily/2026-07-29.md', line: 4, text: 'call the bank 📅 2026-07-29', done: false },
      { path: 'Daily/2026-07-29.md', line: 5, text: 'no due date here', done: false }
    ]
  )

  // The daily note is placed by its filename and not duplicated by `date:`.
  const july29 = entries.get('2026-07-29')!

  assert.equal(july29.length, 2)
  assert.equal(july29[0].kind, 'task', 'actionable items sort first')
  assert.equal(july29[0].label, 'call the bank')
  assert.equal(july29[1].kind, 'daily')

  assert.equal(entries.get('2026-07-30')![0].label, 'Launch')
  assert.equal(entries.has('undefined'), false)
  // A note with no date appears nowhere.
  assert.equal([...entries.values()].flat().some(entry => entry.path === 'Notes/Idea.md'), false)
})

test('the first recognised date key wins, and unusable ones are skipped', () => {
  const entries = collectEntries(
    [
      { path: 'A.md', title: 'A', props: { when: 'someday', due: '2026-08-02' } },
      { path: 'B.md', title: 'B', props: { date: 'TBD' } }
    ],
    []
  )

  assert.equal(entries.get('2026-08-02')![0].path, 'A.md')
  assert.equal([...entries.values()].flat().some(entry => entry.path === 'B.md'), false)
})
