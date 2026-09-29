/**
 * The windowing maths. Getting this wrong is worse than not virtualising at
 * all: too small a window and rows are missing from the screen, too large and
 * the whole point is lost.
 */

import assert from 'node:assert/strict'
import { test } from 'vitest'

import { computeRowWindow } from './virtual-rows'

test('at the top it renders a screenful, not the whole list', () => {
  const window = computeRowWindow(0, 600, 10_000, 30)

  assert.equal(window.start, 0)
  // 20 visible + 12 overscan.
  assert.equal(window.end, 32)
})

test('scrolling moves the window and keeps it bounded', () => {
  const window = computeRowWindow(30_000, 600, 10_000, 30)

  assert.equal(window.start, 988, 'row 1000 minus overscan')
  assert.equal(window.end, 1032)
  assert.ok(window.end - window.start < 60, 'the window must stay small however far you scroll')
})

test('the last screen does not run past the end', () => {
  const window = computeRowWindow(10_000 * 30, 600, 10_000, 30)

  assert.equal(window.end, 10_000)
  assert.ok(window.start < window.end)
})

test('an unmeasured viewport still renders something', () => {
  // clientHeight is 0 before layout. Returning an empty window there would
  // flash a blank table on first paint.
  const window = computeRowWindow(0, 0, 500, 30)

  assert.ok(window.end > 0, 'first paint must not be empty')
})

test('an empty list windows to nothing', () => {
  assert.deepEqual(computeRowWindow(0, 600, 0, 30), { start: 0, end: 0 })
})

test('a negative scrollTop (rubber-banding) clamps to the top', () => {
  assert.equal(computeRowWindow(-220, 600, 500, 30).start, 0)
})
