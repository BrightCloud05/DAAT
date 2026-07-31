/**
 * Fixed-height row windowing.
 *
 * The Notes table rendered every row it had. Measured against a 10,000-note
 * vault that was 160,000 DOM nodes and five seconds to open the screen — and
 * unlike the other views, this one scales with the user's whole library
 * rather than a slice of it, so it gets worse the longer someone uses the app.
 *
 * Rows here are a uniform height, which makes this a multiplication rather
 * than a measurement pass: no per-row observers, and the scrollbar stays the
 * true length of the list because the padding rows above and below carry the
 * full remaining height.
 */

import type { RefObject } from 'react'
import { useEffect, useState } from 'react'

export interface RowWindow {
  /** First row index to render. */
  start: number
  /** One past the last row index to render. */
  end: number
}

/** A screenful either side, so a flick-scroll doesn't outrun React. */
const OVERSCAN = 12

export function computeRowWindow(
  scrollTop: number,
  viewportPx: number,
  total: number,
  rowPx: number,
  overscan = OVERSCAN
): RowWindow {
  if (total <= 0 || rowPx <= 0) {
    return { start: 0, end: 0 }
  }

  // A viewport of 0 means the element hasn't been laid out yet. Rendering
  // nothing then would flash an empty table on first paint, so fall back to
  // a sensible screenful.
  const rows = Math.ceil((viewportPx || 720) / rowPx)
  const first = Math.floor(Math.max(0, scrollTop) / rowPx)

  return {
    start: Math.max(0, first - overscan),
    end: Math.min(total, first + rows + overscan)
  }
}

export function useVirtualRows(
  scrollerRef: RefObject<HTMLElement | null>,
  total: number,
  rowPx: number
): RowWindow {
  const [window, setWindow] = useState<RowWindow>(() => computeRowWindow(0, 0, total, rowPx))

  useEffect(() => {
    const element = scrollerRef.current

    if (!element) {
      return
    }

    let frame = 0

    const measure = () => {
      frame = 0
      setWindow(previous => {
        const next = computeRowWindow(element.scrollTop, element.clientHeight, total, rowPx)

        // Re-rendering on every scroll event with an identical window is the
        // cost this hook exists to avoid.
        return next.start === previous.start && next.end === previous.end ? previous : next
      })
    }

    const onScroll = () => {
      if (!frame) {
        frame = requestAnimationFrame(measure)
      }
    }

    measure()
    element.addEventListener('scroll', onScroll, { passive: true })

    const observer = new ResizeObserver(onScroll)

    observer.observe(element)

    return () => {
      element.removeEventListener('scroll', onScroll)
      observer.disconnect()

      if (frame) {
        cancelAnimationFrame(frame)
      }
    }
  }, [scrollerRef, total, rowPx])

  return window
}
