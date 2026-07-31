/**
 * The bug: dragging the graph to pan around opened a note every time you let go.
 *
 * The old code stored the drag origin pan-relative and then asked "did the
 * pointer move" by subtracting the *current* pan — which mousemove had already
 * recomputed from that same origin. The two cancelled, leaving the distance
 * between the last mousemove and the mouseup, which is zero. So no gesture was
 * ever classified as a pan.
 *
 * These tests replay a real press-move-release sequence rather than asserting
 * on the formula, so they would have failed against the old implementation for
 * the same reason a user would have noticed it.
 */

import assert from 'node:assert/strict'
import { test } from 'vitest'

import { beginDrag, draggedFrom, panFor } from './graph-gesture'

/** Replay a gesture the way the canvas handlers do. */
function gesture(path: Array<[number, number]>) {
  const [[downX, downY]] = path
  let pan = { panX: 0, panY: 0 }
  const origin = beginDrag(downX, downY, pan.panX, pan.panY)

  for (const [x, y] of path.slice(1)) {
    pan = panFor(origin, x, y)
  }

  const [upX, upY] = path[path.length - 1]

  return { pan, opensNote: !draggedFrom(origin, upX, upY) }
}

test('dragging across the canvas pans and does not open a note', () => {
  const { pan, opensNote } = gesture([
    [400, 300],
    [380, 290],
    [320, 260],
    [250, 220]
  ])

  assert.equal(opensNote, false, 'letting go of a pan must not open whatever is under the cursor')
  assert.deepEqual(pan, { panX: -150, panY: -80 })
})

test('a press and release in place opens the node under the cursor', () => {
  const { opensNote } = gesture([
    [400, 300],
    [400, 300]
  ])

  assert.equal(opensNote, true)
})

test('a small tremor still counts as a click', () => {
  // 2px in each axis — inside the slop.
  assert.equal(gesture([[400, 300], [402, 298]]).opensNote, true)
})

test('4px of travel is already a pan', () => {
  assert.equal(gesture([[400, 300], [404, 300]]).opensNote, false)
})

test('a long drag that returns to where it started is still a pan', () => {
  // The pointer ends where it began, so any check that only compares the
  // endpoints of the PAN (rather than the pointer) would call this a click.
  const { pan, opensNote } = gesture([
    [400, 300],
    [200, 300],
    [400, 300]
  ])

  assert.deepEqual(pan, { panX: 0, panY: 0 }, 'camera is back where it started')
  assert.equal(opensNote, true, 'and with no net pointer travel this is indistinguishable from a click')
})

test('panning is relative to the pan in force when the drag began', () => {
  const origin = beginDrag(500, 400, -120, 60)

  assert.deepEqual(panFor(origin, 520, 380), { panX: -100, panY: 40 })
})

test('no drag in progress is never a drag', () => {
  assert.equal(draggedFrom(null, 999, 999), false)
})
