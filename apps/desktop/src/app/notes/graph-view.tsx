/**
 * Link graph — every note, every wikilink between them.
 *
 * Drawn on a canvas rather than in the DOM. A vault of a few thousand notes is
 * several thousand nodes and edges redrawn sixty times a second while the
 * simulation settles; as SVG or divs that is tens of thousands of elements
 * being laid out every frame, which is exactly the kind of screen that makes
 * an app feel broken on a large library.
 *
 * Styling is the same ink-on-paper as everything else: nodes are ink dots
 * sized by how well-connected they are, edges are hairlines. No hue — a
 * rainbow graph looks like a network diagnostics tool, not a notebook.
 */

import { useStore } from '@nanostores/react'
import { forceCenter, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force'
import type { Simulation, SimulationLinkDatum, SimulationNodeDatum } from 'd3-force'
import { useEffect, useMemo, useRef, useState } from 'react'

import { $vaultRevision, openNote } from '../vault/store'
import { beginDrag, type DragOrigin, draggedFrom, panFor, zoomAt } from './graph-gesture'
import { $productLocale, productStrings } from './strings'
import { closeTableView } from './view-store'

// d3 mutates these in place with x/y/vx/vy as the simulation runs, which is
// what SimulationNodeDatum describes.
interface GraphNode extends SimulationNodeDatum {
  path: string
  title: string
  degree: number
}

type GraphEdge = SimulationLinkDatum<GraphNode>

/** Edges after both ends have been resolved to real nodes. */
interface ResolvedEdge {
  source: GraphNode
  target: GraphNode
}

/** Node radius from degree, flattened so one hub can't swamp the picture. */
function radiusOf(degree: number): number {
  return 2.6 + Math.min(6, Math.sqrt(degree) * 1.5)
}

function readVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()

  return value || fallback
}

export function GraphView() {
  const s = productStrings(useStore($productLocale))
  const revision = useStore($vaultRevision)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [graph, setGraph] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null)
  const [hover, setHover] = useState<GraphNode | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Live view state the render loop reads. Kept in refs, not state: the
  // simulation redraws every frame and re-rendering React at 60fps to move a
  // camera would defeat the point of using a canvas at all.
  const view = useRef({ zoom: 1, panX: 0, panY: 0 })
  const nodesRef = useRef<GraphNode[]>([])
  const hoverRef = useRef<GraphNode | null>(null)

  useEffect(() => {
    let cancelled = false

    void window.hermesDesktop.vault
      .linkGraph()
      .then(data => {
        if (cancelled) {
          return
        }

        setGraph({
          nodes: data.nodes.map(node => ({ ...node })),
          edges: data.edges.map(edge => ({ source: edge.source, target: edge.target }))
        })
        setError(null)
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      })

    return () => {
      cancelled = true
    }
  }, [revision])

  const counts = useMemo(
    () => ({ notes: graph?.nodes.length ?? 0, links: graph?.edges.length ?? 0 }),
    [graph]
  )

  useEffect(() => {
    const canvas = canvasRef.current
    const host = hostRef.current

    if (!canvas || !host || !graph || !graph.nodes.length) {
      return
    }

    const context = canvas.getContext('2d')

    if (!context) {
      setError('This machine could not open a 2D canvas.')

      return
    }

    const nodes = graph.nodes
    const byPath = new Map(nodes.map(node => [node.path, node]))
    const edges = graph.edges
      .map(edge => ({
        source: byPath.get(edge.source as string),
        target: byPath.get(edge.target as string)
      }))
      .filter((edge): edge is ResolvedEdge => Boolean(edge.source && edge.target))

    nodesRef.current = nodes

    let width = 0
    let height = 0
    let raf = 0

    const resize = () => {
      const ratio = window.devicePixelRatio || 1
      const rect = host.getBoundingClientRect()

      width = rect.width
      height = rect.height
      canvas.width = Math.max(1, Math.round(width * ratio))
      canvas.height = Math.max(1, Math.round(height * ratio))
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
    }

    resize()

    const simulation: Simulation<GraphNode, undefined> = forceSimulation(nodes)
      .force(
        'link',
        forceLink<GraphNode, ResolvedEdge>(edges)
          .id(node => node.path)
          .distance(46)
          .strength(0.28)
      )
      .force('charge', forceManyBody().strength(-118).distanceMax(420))
      .force('center', forceCenter(0, 0))
      // Islands — notes nobody has linked yet — would drift off to infinity
      // under charge alone. A weak pull home keeps them on screen.
      .force('x', forceX(0).strength(0.045))
      .force('y', forceY(0).strength(0.045))
      // Friction. d3's default of 0.4 lets nodes keep their speed for a long
      // time, so the layout skates around before it settles — the "too fast"
      // the graph felt next to Obsidian's, which is visibly damped. Higher
      // means each tick keeps less of the previous velocity.
      .velocityDecay(0.62)
      // Cooling. Slower than the previous 0.028 so the settling reads as
      // slowing down rather than freezing mid-motion.
      .alphaDecay(0.019)

    const draw = () => {
      const ink = readVar('--ui-text-primary', '#211e1c')
      const line = readVar('--stroke-nous', 'rgba(0,0,0,0.12)')
      const { zoom, panX, panY } = view.current

      context.clearRect(0, 0, width, height)
      context.save()
      context.translate(width / 2 + panX, height / 2 + panY)
      context.scale(zoom, zoom)

      context.strokeStyle = line
      context.lineWidth = 1 / zoom
      context.beginPath()

      for (const edge of edges) {
        context.moveTo(edge.source.x ?? 0, edge.source.y ?? 0)
        context.lineTo(edge.target.x ?? 0, edge.target.y ?? 0)
      }

      context.stroke()

      const active = hoverRef.current

      context.fillStyle = ink

      for (const node of nodes) {
        context.globalAlpha = active && active !== node ? 0.3 : 0.82
        context.beginPath()
        context.arc(node.x ?? 0, node.y ?? 0, radiusOf(node.degree), 0, Math.PI * 2)
        context.fill()
      }

      context.globalAlpha = 1

      // Labels only where they can be read: past a zoom threshold, or on the
      // node under the cursor. Drawing every title at every zoom is the thing
      // that makes a graph unreadable.
      const labelled = zoom > 1.35 ? nodes : active ? [active] : []

      if (labelled.length) {
        context.fillStyle = ink
        context.font = `${11 / zoom}px ${readVar('--dt-font-sans', 'system-ui')}`
        context.textAlign = 'center'
        context.textBaseline = 'top'

        for (const node of labelled) {
          context.globalAlpha = node === active ? 1 : 0.62
          context.fillText(node.title, node.x ?? 0, (node.y ?? 0) + radiusOf(node.degree) + 3 / zoom)
        }

        context.globalAlpha = 1
      }

      context.restore()
    }

    const tick = () => {
      draw()
      raf = requestAnimationFrame(tick)
    }

    tick()

    const observer = new ResizeObserver(resize)

    observer.observe(host)

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      simulation.stop()
    }
  }, [graph])

  /** Canvas coords → graph coords, for hit-testing. */
  const atPointer = (event: React.MouseEvent<HTMLCanvasElement>): GraphNode | null => {
    const canvas = canvasRef.current

    if (!canvas) {
      return null
    }

    const rect = canvas.getBoundingClientRect()
    const { zoom, panX, panY } = view.current
    const x = (event.clientX - rect.left - rect.width / 2 - panX) / zoom
    const y = (event.clientY - rect.top - rect.height / 2 - panY) / zoom

    let best: GraphNode | null = null
    let bestDistance = Infinity

    for (const node of nodesRef.current) {
      const dx = (node.x ?? 0) - x
      const dy = (node.y ?? 0) - y
      const distance = dx * dx + dy * dy
      const reach = radiusOf(node.degree) + 6

      if (distance < reach * reach && distance < bestDistance) {
        best = node
        bestDistance = distance
      }
    }

    return best
  }

  const dragging = useRef<DragOrigin | null>(null)

  return (
    <div className="flex h-full flex-col bg-(--ui-bg-sidebar)">
      <div className="flex shrink-0 items-baseline gap-3 px-10 pt-10 pb-4">
        <h1 className="font-(--dt-font-serif) text-[28px] font-medium tracking-[-0.01em]">{s.graph}</h1>
        <span className="text-[12.5px] opacity-45">{s.graphCount(counts.notes, counts.links)}</span>
        <button
          className="ml-auto rounded-xs border border-(--stroke-nous) px-2.5 py-1 text-[12.5px] transition-colors hover:bg-(--ui-control-hover-background)"
          onClick={() => {
            view.current = { zoom: 1, panX: 0, panY: 0 }
          }}
        >
          {s.graphRecenter}
        </button>
      </div>

      <div className="relative min-h-0 flex-1" ref={hostRef}>
        <canvas
          className="absolute inset-0 cursor-grab active:cursor-grabbing"
          onMouseDown={event => {
            dragging.current = beginDrag(event.clientX, event.clientY, view.current.panX, view.current.panY)
          }}
          onMouseLeave={() => {
            dragging.current = null
            hoverRef.current = null
            setHover(null)
          }}
          onMouseMove={event => {
            if (dragging.current) {
              const next = panFor(dragging.current, event.clientX, event.clientY)

              view.current.panX = next.panX
              view.current.panY = next.panY

              return
            }

            const node = atPointer(event)

            hoverRef.current = node
            setHover(previous => (previous === node ? previous : node))
          }}
          onMouseUp={event => {
            const origin = dragging.current

            dragging.current = null

            // A gesture that travelled is a pan, not a click on whatever ended
            // up under the cursor. Measured against the raw press coordinates:
            // comparing against the live pan cancels out, because panning is
            // computed from that same origin (see graph-gesture.ts).
            if (draggedFrom(origin, event.clientX, event.clientY)) {
              return
            }

            const node = atPointer(event)

            if (node) {
              closeTableView()
              void openNote(node.path)
            }
          }}
          onWheel={event => {
            const rect = canvasRef.current?.getBoundingClientRect()

            if (!rect) {
              return
            }

            // Scaled by the delta and anchored at the pointer — see
            // graph-gesture.ts. The previous version stepped a fixed 12% per
            // event around the canvas centre, which on a trackpad threw the
            // graph across the screen.
            view.current = zoomAt(
              view.current,
              event.deltaY,
              // macOS delivers pinch-to-zoom as a wheel event with ctrlKey.
              event.ctrlKey,
              event.clientX - rect.left,
              event.clientY - rect.top,
              rect.width,
              rect.height
            )
          }}
          ref={canvasRef}
        />

        {error ? (
          <div className="absolute inset-0 grid place-items-center px-8 text-center text-[13px] opacity-60">
            {error}
          </div>
        ) : null}

        {!error && graph && !graph.nodes.length ? (
          <div className="absolute inset-0 grid place-items-center px-8">
            <div className="max-w-[22rem] text-center">
              <p className="m-0 font-(--dt-font-serif) text-[20px]">{s.graphEmptyTitle}</p>
              <p className="mt-2 mb-0 text-[13px] leading-relaxed opacity-55">{s.graphEmptyBody}</p>
            </div>
          </div>
        ) : null}

        {hover ? (
          <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-xs border border-(--stroke-nous) bg-(--dt-popover) px-2.5 py-1 text-[12.5px]">
            {hover.title}
            <span className="ml-2 opacity-45">{s.graphLinkCount(hover.degree)}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
