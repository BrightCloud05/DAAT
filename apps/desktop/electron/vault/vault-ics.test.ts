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

test('a TZID-timed event is converted to the local display zone', () => {
  const events = parseIcs(wrap([`DTSTART;TZID=UTC:${icsDate(5)}T143000`, 'SUMMARY:Client meeting', 'UID:two']))

  const date = icsDate(5)
  const expected = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T14:30:00Z`)
  assert.equal(events[0].time, `${pad(expected.getHours())}:${pad(expected.getMinutes())}`)
})

test('folded lines unfold before parsing', () => {
  const events = parseIcs(
    wrap([`DTSTART;VALUE=DATE:${icsDate(1)}`, 'SUMMARY:A very long tit', ' le split across lines', 'UID:three'])
  )

  assert.equal(events[0].summary, 'A very long title split across lines')
})

test('escaped text unescapes: commas, semicolons, newlines', () => {
  const events = parseIcs(wrap([`DTSTART;VALUE=DATE:${icsDate(1)}`, 'SUMMARY:Tax\\, BAS\\; and more', 'UID:four']))

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

  const dates = events.flatMap(event => event.dates)
  assert.equal(dates.length, 3)

  const [first, second] = dates
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

test('recurrence exclusions, moved exceptions and cancellations use original identity and the event timezone', () => {
  const text = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:series',
    'DTSTART;TZID=America/New_York:20260915T093000',
    'RRULE:FREQ=DAILY;COUNT=4',
    'EXDATE;TZID=America/New_York:20260916T093000',
    'SUMMARY:Class',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:series',
    'RECURRENCE-ID;TZID=America/New_York:20260917T093000',
    'DTSTART;TZID=America/New_York:20260918T113000',
    'SUMMARY:Moved class',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:series',
    'RECURRENCE-ID;TZID=America/New_York:20260918T093000',
    'STATUS:CANCELLED',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n')

  const events = parseIcs(text, new Date(2026, 8, 15))
  assert.equal(events.length, 2)
  const moved = events.find(event => event.summary === 'Moved class')!
  assert.ok(moved)
  assert.match(moved.occurrence, /2026-09-17/)
  const actual = new Date('2026-09-18T15:30:00Z')
  assert.equal(moved.dates[0], `${actual.getFullYear()}-${pad(actual.getMonth() + 1)}-${pad(actual.getDate())}`)
  assert.equal(moved.time, `${pad(actual.getHours())}:${pad(actual.getMinutes())}`)
  const canceledSeries = text.replace('UID:series', 'UID:series\r\nSTATUS:CANCELLED')
  assert.equal(parseIcs(canceledSeries, new Date(2026, 8, 15)).length, 0)
})

test('monthly ordinal recurrence and source DST change preserve the real occurrence instants', () => {
  const events = parseIcs(
    wrap([
      'UID:monthly',
      'DTSTART;TZID=America/New_York:20260925T090000',
      'RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=3',
      'SUMMARY:Review'
    ]),
    new Date(2026, 8, 25)
  )

  const expected = ['2026-09-25T13:00:00Z', '2026-10-30T13:00:00Z', '2026-11-27T14:00:00Z'].map(
    value => new Date(value)
  )

  assert.equal(events.length, expected.length)
  assert.deepEqual(
    events.map(event => `${event.dates[0]} ${event.time}`),
    expected.map(
      date =>
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    )
  )
  assert.throws(() => parseIcs('<html>Temporary outage</html>'), /not an iCalendar/)
})
