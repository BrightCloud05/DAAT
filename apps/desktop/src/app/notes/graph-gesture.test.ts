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

import { beginDrag, type Camera, draggedFrom, MAX_ZOOM, MIN_ZOOM, panFor, zoomAt } from './graph-gesture'

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

// ─── Zoom ──────────────────────────────────────────────────────────────────

test('the point under the cursor does not move when you zoom', () => {
  // This is the whole feel of it. Centre-anchored zoom pushes whatever you were
  // looking at off screen as you magnify it.
  const W = 1000
  const H = 600
  const before: Camera = { zoom: 1, panX: 0, panY: 0 }
  const cx = 800
  const cy = 150

  // Graph coordinates under the cursor, per the draw transform.
  const gx = (cx - W / 2 - before.panX) / before.zoom
  const gy = (cy - H / 2 - before.panY) / before.zoom

  const after = zoomAt(before, -300, false, cx, cy, W, H)

  assert.ok(after.zoom > before.zoom, 'a negative deltaY zooms in')

  // Where that same graph point now lands on screen.
  const screenX = gx * after.zoom + W / 2 + after.panX
  const screenY = gy * after.zoom + H / 2 + after.panY

  assert.ok(Math.abs(screenX - cx) < 1e-9, `x drifted by ${screenX - cx}`)
  assert.ok(Math.abs(screenY - cy) < 1e-9, `y drifted by ${screenY - cy}`)
})

test('a small trackpad delta makes a small change', () => {
  // The bug: a fixed 12% per wheel EVENT. A trackpad swipe fires dozens of
  // small events, so the graph shot away. Now the delta decides the size.
  const camera: Camera = { zoom: 1, panX: 0, panY: 0 }
  const tiny = zoomAt(camera, -4, false, 500, 300, 1000, 600)
  const notch = zoomAt(camera, -100, false, 500, 300, 1000, 600)

  assert.ok(tiny.zoom - 1 < 0.01, `a 4px delta should barely move: got ${tiny.zoom}`)
  assert.ok(notch.zoom > tiny.zoom, 'a full mouse notch moves more than a trackpad nudge')
  assert.ok(notch.zoom < 1.3, `and a single notch should not leap: got ${notch.zoom}`)
})

test('many small deltas equal one big delta', () => {
  // Exponential scaling composes, so a smooth swipe and a single flick of the
  // same total distance land in the same place. A per-event step cannot do this.
  let stepped: Camera = { zoom: 1, panX: 0, panY: 0 }

  for (let i = 0; i < 25; i++) {
    stepped = zoomAt(stepped, -4, false, 500, 300, 1000, 600)
  }

  const once = zoomAt({ zoom: 1, panX: 0, panY: 0 }, -100, false, 500, 300, 1000, 600)

  assert.ok(Math.abs(stepped.zoom - once.zoom) < 1e-9, `${stepped.zoom} vs ${once.zoom}`)
})

test('pinch is coarser than wheel, because macOS sends coarser deltas', () => {
  const camera: Camera = { zoom: 1, panX: 0, panY: 0 }

  assert.ok(
    zoomAt(camera, -20, true, 500, 300, 1000, 600).zoom >
      zoomAt(camera, -20, false, 500, 300, 1000, 600).zoom
  )
})

test('zoom cannot run past its stops', () => {
  let camera: Camera = { zoom: 1, panX: 0, panY: 0 }

  for (let i = 0; i < 200; i++) camera = zoomAt(camera, -200, false, 500, 300, 1000, 600)
  assert.equal(camera.zoom, MAX_ZOOM)

  for (let i = 0; i < 400; i++) camera = zoomAt(camera, 200, false, 500, 300, 1000, 600)
  assert.equal(camera.zoom, MIN_ZOOM)
})

test('a clamped zoom leaves the camera exactly alone', () => {
  // Re-anchoring on a no-op zoom would drift the pan every time the user kept
  // scrolling at the limit.
  const atMax: Camera = { zoom: MAX_ZOOM, panX: 120, panY: -40 }

  assert.deepEqual(zoomAt(atMax, -500, false, 700, 200, 1000, 600), atMax)
})
