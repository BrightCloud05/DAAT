/**
 * The ICS parser feeding calendar subscriptions. Real feeds are line-folded,
 * escaped, and full of recurrence — the parser only has to be right about
 * the fields we materialize (DTSTART, SUMMARY, UID, LOCATION, RRULE).
 */

import assert from 'node:assert/strict'
import { test } from 'vitest'

import { parseIcs } from './vault-ics'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** YYYYMMDD for `daysFromNow`, so tests stay inside the sync window forever. */
function icsDate(daysFromNow: number): string {
  const date = new Date()

  date.setDate(date.getDate() + daysFromNow)

  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
}

function wrap(vevent: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', ...vevent, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')
}

test('an all-day event lands on its day, untimed', () => {
  const events = parseIcs(wrap([`DTSTART;VALUE=DATE:${icsDate(3)}`, 'SUMMARY:BAS deadline', 'UID:one']))

  assert.equal(events.length, 1)
  assert.equal(events[0].summary, 'BAS deadline')
  assert.equal(events[0].time, undefined)
  assert.equal(events[0].dates.length, 1)
  assert.match(events[0].dates[0], /^\d{4}-\d{2}-\d{2}$/)
})

test('a TZID-timed event keeps its wall-clock time', () => {
  const events = parseIcs(
    wrap([`DTSTART;TZID=Australia/Sydney:${icsDate(5)}T143000`, 'SUMMARY:Client meeting', 'UID:two'])
  )

  assert.equal(events[0].time, '14:30')
})

test('folded lines unfold before parsing', () => {
  const events = parseIcs(
    wrap([`DTSTART;VALUE=DATE:${icsDate(1)}`, 'SUMMARY:A very long tit', ' le split across lines', 'UID:three'])
  )

  assert.equal(events[0].summary, 'A very long title split across lines')
})

test('escaped text unescapes: commas, semicolons, newlines', () => {
  const events = parseIcs(
    wrap([`DTSTART;VALUE=DATE:${icsDate(1)}`, 'SUMMARY:Tax\\, BAS\\; and more', 'UID:four'])
  )

  assert.equal(events[0].summary, 'Tax, BAS; and more')
})

test('weekly recurrence expands inside the window', () => {
  const events = parseIcs(
    wrap([
      `DTSTART;TZID=Australia/Sydney:${icsDate(-2)}T090000`,
      'RRULE:FREQ=WEEKLY;COUNT=3',
      'SUMMARY:Weekly class',
      'UID:five'
    ])
  )

  assert.equal(events.length, 1)
  assert.equal(events[0].dates.length, 3)

  const [first, second] = events[0].dates
  const gapDays = (Date.parse(second) - Date.parse(first)) / 86_400_000

  assert.equal(gapDays, 7)
})

test('events far outside the window are dropped', () => {
  const events = parseIcs(wrap(['DTSTART;VALUE=DATE:19990101', 'SUMMARY:Ancient', 'UID:six']))

  assert.equal(events.length, 0)
})

test('an event without UID or DTSTART is skipped, not crashed on', () => {
  const events = parseIcs(wrap(['SUMMARY:No date at all', 'UID:seven']))

  assert.equal(events.length, 0)
})
