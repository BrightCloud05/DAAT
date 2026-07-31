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
