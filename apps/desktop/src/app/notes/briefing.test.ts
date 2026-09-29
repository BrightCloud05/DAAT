/**
 * The morning briefing.
 *
 * It used to read "You have 17 pages, 0 open tasks" — a fact about the
 * database, not the day. A count that only goes up carries no information: it
 * reads identically on the morning something is overdue and the morning nothing
 * is. These tests are about the ordering, because the whole value is that the
 * most urgent true thing comes first.
 */

import assert from 'node:assert/strict'
import { test } from 'vitest'

import { briefingParts, buildBriefing, daysUntil } from './briefing'

const TODAY = '2026-07-31'
const base = { today: TODAY, hasDaily: false, pageCount: 17 }
const task = (label: string, due?: string, done = false) => ({ label, due, done })

test('an empty vault says so instead of reporting zero', () => {
  const b = buildBriefing({ ...base, pageCount: 0, tasks: [] }, false)

  assert.equal(b.tone, 'empty')
  assert.doesNotMatch(b.text, /\b0\b/)
})

test('overdue beats everything else', () => {
  const b = buildBriefing(
    {
      ...base,
      tasks: [task('Read chapter 4', '2026-08-02'), task('Assignment 2', '2026-07-28'), task('Email tutor', TODAY)]
    },
    false
  )

  assert.equal(b.tone, 'late')
  assert.match(b.text, /Assignment 2/, 'the overdue item leads, not the one due today')
  assert.match(b.text, /3 days overdue/)
})

test('several overdue items are counted, with the oldest named', () => {
  const b = buildBriefing(
    { ...base, tasks: [task('A', '2026-07-20'), task('B', '2026-07-29')] },
    false
  )

  assert.match(b.text, /2 things are overdue/)
  assert.match(b.text, /the oldest is A/)
})

test('due today comes next', () => {
  const b = buildBriefing({ ...base, tasks: [task('Lab report', TODAY), task('Later', '2026-08-05')] }, false)

  assert.equal(b.tone, 'today')
  assert.match(b.text, /\*\*Lab report\*\* is due today/)
})

test('then the nearest thing coming up', () => {
  const b = buildBriefing({ ...base, tasks: [task('Assignment 2', '2026-08-02')] }, false)

  assert.equal(b.tone, 'soon')
  assert.match(b.text, /due in 2 days/)
})

test('a deadline far out is not manufactured into urgency', () => {
  const b = buildBriefing({ ...base, tasks: [task('Thesis', '2026-12-01')], lastEdited: 'Week 6' }, false)

  assert.equal(b.tone, 'calm')
  assert.match(b.text, /Nothing is due/)
  assert.match(b.text, /Week 6/)
})

test('completed work never appears', () => {
  const b = buildBriefing({ ...base, tasks: [task('Done thing', '2026-07-01', true)] }, false)

  assert.equal(b.tone, 'calm')
  assert.doesNotMatch(b.text, /Done thing/)
})

test('undated tasks do not create a deadline', () => {
  const b = buildBriefing({ ...base, tasks: [task('Someday'), task('Maybe')] }, false)

  assert.equal(b.tone, 'calm')
})

test('a malformed due date is ignored rather than shown as NaN', () => {
  const b = buildBriefing({ ...base, tasks: [task('Broken', 'not-a-date')] }, false)

  assert.equal(b.tone, 'calm')
  assert.doesNotMatch(b.text, /NaN|Invalid/)
})

test('singular and plural days both read correctly', () => {
  const one = buildBriefing({ ...base, tasks: [task('X', '2026-08-01')] }, false)
  const two = buildBriefing({ ...base, tasks: [task('X', '2026-08-02')] }, false)

  assert.match(one.text, /in 1 day\./)
  assert.match(two.text, /in 2 days\./)

  const lateOne = buildBriefing({ ...base, tasks: [task('Y', '2026-07-30')] }, false)

  assert.match(lateOne.text, /1 day overdue/)
})

test('Korean gets its own sentence, not a translated template', () => {
  const b = buildBriefing({ ...base, tasks: [task('과제 2', '2026-07-28')] }, true)

  assert.match(b.text, /과제 2/)
  assert.match(b.text, /3일 지났습니다/)
  assert.doesNotMatch(b.text, /overdue|due/)
})

test('daysUntil counts whole days in both directions', () => {
  assert.equal(daysUntil(TODAY, TODAY), 0)
  assert.equal(daysUntil(TODAY, '2026-08-01'), 1)
  assert.equal(daysUntil(TODAY, '2026-07-28'), -3)
  assert.equal(daysUntil(TODAY, 'rubbish'), Number.POSITIVE_INFINITY)
})

test('the emphasis marks split cleanly for rendering', () => {
  assert.deepEqual(briefingParts('**Assignment 2** is due today.'), [
    { text: 'Assignment 2', strong: true },
    { text: ' is due today.', strong: false }
  ])

  assert.deepEqual(briefingParts('no emphasis here'), [{ text: 'no emphasis here', strong: false }])
})
