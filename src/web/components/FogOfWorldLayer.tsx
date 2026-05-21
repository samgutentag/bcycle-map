import { useEffect, useMemo, useRef } from 'react'
import type maplibregl from 'maplibre-gl'
import type { RouteCache } from '@shared/route-cache'
import type { Trip } from '@shared/types'
import { decodePolyline } from '@shared/polyline'
import { lookupRoute } from '@shared/route-cache'
import {
  buildCumulativeDistance,
  tripFraction,
  type LngLat,
} from '../lib/flow-interpolate'

/**
 * "Fog of the world" overlay (#57). When enabled, the map is darkened by a
 * solid black layer at FOG_ALPHA opacity, and each visible trip "carves" a
 * lit corridor along its cached polyline using a destination-out composite.
 *
 * Architecture:
 *  - Separate <canvas> at z-index 4 (below BikeAnimationLayer at z-index 5).
 *  - pointerEvents: 'none' so the map keeps all pan/zoom interactions.
 *  - Fog accumulates frame-to-frame — we DO NOT clearRect every frame the way
 *    the bike layer does. Instead the canvas is "primed" with fog on mount /
 *    reset, and each frame just strokes destination-out paths for the trips
 *    that have advanced since the last frame.
 *  - The reveal extends only up to each bike's current position (per spec):
 *    the lit corridor "grows" as the bike moves through it, rather than the
 *    entire route popping into view the instant the trip becomes active.
 *
 * Reset triggers (clearRect + re-fill with fog):
 *  - The map's camera moves (pan/zoom) — fog is projected per-frame from
 *    geographic coordinates, so stale pixels from the prior viewport are
 *    meaningless. Re-prime + redraw progress from scratch.
 *  - The `enabled` flag flips on (fresh canvas).
 *  - Canvas resize (DPR change or container resize) wipes the bitmap.
 *
 * What does NOT reset (intentional cumulative behavior):
 *  - Cursor changes of any size — destination-out is monotonic (can only
 *    add cleared area, never re-fog), so the accumulator naturally grows
 *    as playback advances. Manual scrubs and playback-loop wraps both
 *    leave the existing carved area intact.
 *  - Trip-set reference changes from the poller — useFlowTrips returns
 *    a fresh array on every poll tick. Resetting on that would wipe the
 *    fog every ~30s. The trip list grows; previously-carved corridors
 *    stay regardless of whether the source trip is still in the array.
 *
 * Polyline source: duplicates `prepareTrips` from BikeAnimationLayer rather
 * than lifting into a shared hook. The function is ~10 lines, the data is
 * per-trip, and keeping the fog layer self-contained makes it trivial to
 * delete if we ever drop the feature. Memory cost is one extra polyline +
 * cumDist array per visible trip (capped at maxBikes).
 */

const FOG_COLOR = 'rgba(0, 0, 0, 0.72)'
/** ~28% of the basemap shows through the fog. Tune by adjusting alpha. */
const FOG_FILL_ALPHA = 0.72
/** Width of the carved-out corridor, in CSS pixels. Thick enough to read at
 * city-scale zoom. */
const LIT_STROKE_PX = 12

type PreparedTrip = {
  trip: Trip
  poly: LngLat[]
  cum: number[]
}

type Props = {
  map: maplibregl.Map | null
  trips: Trip[]
  routes: RouteCache | null
  cursorTs: number
  /** Off by default. When false the canvas does not render — the original
   * "all visible" basemap treatment is preserved. */
  enabled: boolean
}

/**
 * Duplicated from BikeAnimationLayer.prepareTrips (minus the unused matrix /
 * color fields). See the JSDoc above for rationale.
 */
export function prepareFogTrips(
  trips: Trip[],
  routes: RouteCache | null,
): PreparedTrip[] {
  if (!routes) return []
  const out: PreparedTrip[] = []
  for (const trip of trips) {
    const edge = lookupRoute(routes, trip.from_station_id, trip.to_station_id)
    if (!edge) continue
    const poly = decodePolyline(edge.polyline)
    if (poly.length < 2) continue
    const cum = buildCumulativeDistance(poly)
    out.push({ trip, poly, cum })
  }
  return out
}

/**
 * Stroke the carved-out path for a single prepared trip onto the fog canvas,
 * from the trip's polyline start up to the bike's current interpolated
 * position. Uses destination-out so each stroke erases fog rather than
 * painting black. Exported for testing.
 */
export function carveTripPath(
  ctx: CanvasRenderingContext2D,
  map: maplibregl.Map,
  prep: PreparedTrip,
  cursorTs: number,
  strokePx: number,
): void {
  const { trip, poly, cum } = prep
  if (trip.departure_ts > cursorTs) return
  const total = cum[cum.length - 1] ?? 0
  if (total <= 0) return
  const f = tripFraction(cursorTs, trip.departure_ts, trip.arrival_ts)
  if (f <= 0) return

  const target = f * total
  ctx.beginPath()
  const p0 = map.project(poly[0] as [number, number])
  ctx.moveTo(p0.x, p0.y)
  for (let i = 1; i < poly.length; i++) {
    if (cum[i]! >= target) {
      // Final segment ends at the bike's exact interpolated position so the
      // carved tip lines up with the BikeAnimationLayer's trail tip.
      const segStart = cum[i - 1]!
      const segLen = cum[i]! - segStart
      const local = segLen === 0 ? 0 : (target - segStart) / segLen
      const a = poly[i - 1]!
      const b = poly[i]!
      const tip: [number, number] = [
        a[0] + (b[0] - a[0]) * local,
        a[1] + (b[1] - a[1]) * local,
      ]
      const pTip = map.project(tip)
      ctx.lineTo(pTip.x, pTip.y)
      break
    }
    const pPx = map.project(poly[i] as [number, number])
    ctx.lineTo(pPx.x, pPx.y)
  }
  ctx.lineWidth = strokePx
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.stroke()
}

export default function FogOfWorldLayer({
  map,
  trips,
  routes,
  cursorTs,
  enabled,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const dprRef = useRef<number>(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)
  const rafRef = useRef<number | null>(null)
  const needsPrimeRef = useRef<boolean>(true)

  // Per-trip polyline + cumulative-distance prep. Duplicated from
  // BikeAnimationLayer (see module JSDoc). Memoized on the same dependencies
  // so we only re-prepare when the underlying trip / route data changes.
  const prepared = useMemo(() => prepareFogTrips(trips, routes), [trips, routes])
  const preparedRef = useRef<PreparedTrip[]>(prepared)
  preparedRef.current = prepared

  const cursorTsRef = useRef(cursorTs)
  cursorTsRef.current = cursorTs

  // Prime the canvas with solid fog. Called on mount, on `enabled` flipping
  // on, on cursor jumps, on map camera moves, and on prepared-trips changes.
  const primeFog = (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => {
    const dpr = dprRef.current
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr)
    ctx.fillStyle = FOG_COLOR
    ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr)
  }

  // Resize the canvas to match the map container. Same pattern as
  // BikeAnimationLayer — pixel ratio for retina crispness.
  useEffect(() => {
    if (!enabled || !map) return
    const canvas = canvasRef.current
    if (!canvas) return
    const container = map.getContainer()
    const dpr = window.devicePixelRatio || 1
    dprRef.current = dpr
    const sync = () => {
      const w = container.clientWidth
      const h = container.clientHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      // Canvas resize wipes the contents; mark for re-priming on next frame.
      needsPrimeRef.current = true
    }
    sync()
    map.on('resize', sync)
    return () => { map.off('resize', sync) }
  }, [map, enabled])

  // Camera-move reset: the fog accumulator stores pixel-space strokes, so
  // any pan/zoom invalidates the prior content. We re-prime and the next
  // frame redraws all visible trips' carved paths from scratch.
  useEffect(() => {
    if (!enabled || !map) return
    const onMove = () => { needsPrimeRef.current = true }
    map.on('move', onMove)
    map.on('zoom', onMove)
    return () => {
      map.off('move', onMove)
      map.off('zoom', onMove)
    }
  }, [map, enabled])

  // The render loop. Distinct from BikeAnimationLayer's loop — this one runs
  // on its own rAF so the fog redraws even when the bike layer is paused
  // (e.g. mid-scrub the user is still examining a single still frame).
  useEffect(() => {
    if (!enabled || !map) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // First frame: prime + paint current cursor's progress.
    needsPrimeRef.current = true

    const draw = () => {
      const dpr = dprRef.current
      const cursor = cursorTsRef.current

      if (needsPrimeRef.current) {
        primeFog(canvas, ctx)
        needsPrimeRef.current = false
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      // destination-out: where we draw, alpha is removed from the canvas.
      // The basemap below shines through cleanly along each trip's carved
      // path. Color is irrelevant under this composite — only the alpha
      // matters — but a solid color avoids surprises if a future engine
      // changes the composite semantics. Crucially, destination-out is
      // monotonic: each frame's strokes only *add* to the cleared region,
      // so the fog naturally accumulates as playback advances without any
      // explicit accumulator state.
      ctx.globalCompositeOperation = 'destination-out'
      ctx.globalAlpha = 1
      ctx.strokeStyle = `rgba(0, 0, 0, ${FOG_FILL_ALPHA})`

      for (const prep of preparedRef.current) {
        carveTripPath(ctx, map, prep, cursor, LIT_STROKE_PX)
      }

      // Restore default composite so any future ops on this context behave
      // predictably. (Not strictly necessary as we set it again next frame.)
      ctx.globalCompositeOperation = 'source-over'

      rafRef.current = window.requestAnimationFrame(draw)
    }

    rafRef.current = window.requestAnimationFrame(draw)
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [map, enabled])

  if (!enabled) return null

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      data-testid="fog-of-world-canvas"
      css={{
        position: 'absolute',
        inset: 0,
        // Below the bike layer (z-index 5) — bikes ride on top of the
        // carved corridors so the head-of-trail marker stays the visual
        // focus.
        zIndex: 4,
        pointerEvents: 'none',
      }}
    />
  )
}
