/**
 * Pan-vs-click for the graph canvas.
 *
 * Extracted from the JSX because the arithmetic is the whole feature and it was
 * wrong: the drag origin was stored pan-relative (`clientX - panX`) and then
 * compared against a `panX` that mousemove had already overwritten. Substituting
 * what mousemove writes:
 *
 *   panX          = lastMoveX - origin.x
 *   clientX - origin.x - panX
 *                 = clientX - origin.x - (lastMoveX - origin.x)
 *                 = clientX - lastMoveX
 *
 * and mouseup fires at the same coordinates as the last mousemove, so that is
 * always ~0. Every pan was therefore treated as a click, and letting go of a
 * drag opened whichever note happened to be under the cursor.
 *
 * The fix is to keep the raw pointer origin and the pan offset as separate
 * numbers, so "did the pointer move" never has to be recovered from a value
 * that panning mutates.
 */

/** Pointer travel below this is a click with a shaky hand, not a pan. */
export const DRAG_SLOP_PX = 3

export interface DragOrigin {
  /** Raw client coords where the press started. */
  x: number
  y: number
  /** Pan offset at press time, so movement can be applied as a delta. */
  panX: number
  panY: number
}

export function beginDrag(clientX: number, clientY: number, panX: number, panY: number): DragOrigin {
  return { x: clientX, y: clientY, panX, panY }
}

/** Where the camera should sit while dragging from `origin` to the pointer. */
export function panFor(origin: DragOrigin, clientX: number, clientY: number): { panX: number; panY: number } {
  return {
    panX: origin.panX + (clientX - origin.x),
    panY: origin.panY + (clientY - origin.y)
  }
}

/**
 * True when the pointer travelled far enough that this gesture was a pan.
 * Measured against the raw press coordinates, never against the live pan.
 */
export function draggedFrom(origin: DragOrigin | null, clientX: number, clientY: number): boolean {
  if (!origin) {
    return false
  }

  return Math.abs(clientX - origin.x) > DRAG_SLOP_PX || Math.abs(clientY - origin.y) > DRAG_SLOP_PX
}

// ─── Zoom ──────────────────────────────────────────────────────────────────

/** Hard stops, so the graph can never be lost off-scale. */
export const MIN_ZOOM = 0.15
export const MAX_ZOOM = 6

/**
 * How much one unit of wheel delta scales the view.
 *
 * The first version stepped a fixed 12% per wheel EVENT and ignored deltaY.
 * A mouse notch is one event, so that felt fine — but a trackpad swipe emits
 * dozens of small events, and the graph shot away from under the user. Scaling
 * by the delta makes a small gesture a small change, which is the whole
 * difference in feel.
 */
const WHEEL_SENSITIVITY = 0.0016

/** macOS delivers pinch as a wheel event with ctrlKey and coarser deltas. */
const PINCH_SENSITIVITY = 0.008

export interface Camera {
  zoom: number
  panX: number
  panY: number
}

/**
 * Zoom toward the pointer, not the middle of the canvas.
 *
 * Centre-anchored zoom pushes whatever you were looking at off screen as you
 * magnify it, which is the opposite of what you meant. Anchoring at the cursor
 * keeps the graph point under it exactly where it is — the behaviour every
 * map, and Obsidian's own graph, has.
 *
 * `cx`/`cy` are pointer coordinates relative to the canvas; `width`/`height`
 * its size. The draw transform is translate(w/2 + panX, h/2 + panY)·scale(z),
 * so a graph point maps to screen as `p*z + w/2 + panX`, and holding that
 * fixed while z changes gives the pan below.
 */
export function zoomAt(
  camera: Camera,
  deltaY: number,
  pinch: boolean,
  cx: number,
  cy: number,
  width: number,
  height: number
): Camera {
  const factor = Math.exp(-deltaY * (pinch ? PINCH_SENSITIVITY : WHEEL_SENSITIVITY))
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * factor))

  // Nothing to re-anchor if the clamp swallowed the change.
  if (zoom === camera.zoom) {
    return camera
  }

  // The graph coordinates currently under the pointer.
  const gx = (cx - width / 2 - camera.panX) / camera.zoom
  const gy = (cy - height / 2 - camera.panY) / camera.zoom

  return {
    zoom,
    panX: cx - width / 2 - gx * zoom,
    panY: cy - height / 2 - gy * zoom
  }
}
