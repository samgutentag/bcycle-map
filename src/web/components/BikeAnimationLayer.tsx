import { useEffect, useMemo, useRef } from 'react'
import type maplibregl from 'maplibre-gl'
import type { RouteCache } from '@shared/route-cache'
import type { Trip } from '@shared/types'
import { decodePolyline } from '@shared/polyline'
import { lookupRoute } from '@shared/route-cache'
import {
  buildCumulativeDistance,
  interpolatePolyline,
  tripFraction,
  classifyDuration,
  type DurationClass,
  type LngLat,
} from '../lib/flow-interpolate'
import {
  lookupTravelTime,
  type TravelMatrix,
} from '../hooks/useTravelMatrix'

/**
 * Canvas overlay that draws one animated dot per visible trip along its cached
 * polyline. Lives in absolutely-positioned <canvas> on top of the MapLibre map,
 * synced to the map's camera so the dots track pan/zoom.
 *
 * Architecture notes:
 *  - Single <canvas>, single requestAnimationFrame loop. We do NOT mount 80 DOM
 *    nodes. Even with cheap CSS transforms, that's too many separate layers for
 *    smooth interactive scrubbing on mid-tier hardware.
 *  - Trip → polyline lookup happens once per render (memoized on the trips prop).
 *    The rAF loop only does interpolation math + paint.
 *  - The cursor is held in a ref so the rAF loop can advance it during playback
 *    without re-rendering React on every frame. The parent owns the "official"
 *    cursor state but doesn't need 60 commits per second.
 *  - When the user is dragging the scrubber (parent provides a cursorTs prop),
 *    we draw a single still frame at that cursor — no playback motion.
 *
 * Anti-clutter rule (from the spec): trips without a cached polyline are
 * silently dropped. Straight-line fallbacks turn the canvas into a cobweb.
 */

const DOT_RADIUS = 4
const BIKE_EMOJI_PX = 18  // glyph size for the 🚴 head-of-trail marker
const TRAIL_STEPS = 3
const TRAIL_GAP_SEC = 20  // ~20s behind the bike, fading

const COLORS: Record<DurationClass, string> = {
  fast: '#0d6cb0',     // blue — same as live-map "typical" indicator
  slow: '#dc2626',     // red — matches the "+/- vs typical" warning hue
  typical: '#525252',  // neutral mid-gray, visible on both basemaps
  unknown: '#94a3b8',  // muted slate — flat tone for "no matrix data"
}

type PreparedTrip = {
  trip: Trip
  poly: LngLat[]
  cum: number[]
  color: string
}

type Props = {
  map: maplibregl.Map | null
  trips: Trip[]
  routes: RouteCache | null
  matrix: TravelMatrix | null
  /** Authoritative cursor (Unix seconds). Used as the still-frame time when
   * `playing` is false; used as the playback anchor when `playing` is true. */
  cursorTs: number
  /** When true, the rAF loop advances the cursor at `playbackRate` seconds per
   * wall-clock second. When false, all bikes draw at their cursor-time position. */
  playing: boolean
  /** Seconds of cursor advance per real-time second. Default 60x means 24h
   * scrubs in 24 real-minutes, matching the spec. */
  playbackRate?: number
  /** Hard cap on bikes drawn per frame. Parent has already trimmed `trips`
   * but we re-clamp defensively to keep the canvas budget honest. */
  maxBikes?: number
  /** Window end — playback wraps back to windowStart on reaching this. */
  windowEnd: number
  /** Window start — playback wrap target. */
  windowStart: number
  /** Called with the cursor's new value during playback so the parent can keep
   * its state in rough sync (we throttle internally to ~4Hz to avoid React
   * re-render storms; full smoothness is provided by the canvas itself). */
  onCursorAdvance?: (ts: number) => void
}

function prepareTrips(
  trips: Trip[],
  routes: RouteCache | null,
  matrix: TravelMatrix | null,
): PreparedTrip[] {
  if (!routes) return []
  const out: PreparedTrip[] = []
  for (const trip of trips) {
    const edge = lookupRoute(routes, trip.from_station_id, trip.to_station_id)
    if (!edge) continue
    const poly = decodePolyline(edge.polyline)
    if (poly.length < 2) continue
    const cum = buildCumulativeDistance(poly)
    const typical = lookupTravelTime(matrix, trip.from_station_id, trip.to_station_id)
    const cls = classifyDuration(trip.duration_sec, typical ? typical.minutes * 60 : null)
    out.push({ trip, poly, cum, color: COLORS[cls] })
  }
  return out
}

export default function BikeAnimationLayer({
  map,
  trips,
  routes,
  matrix,
  cursorTs,
  playing,
  playbackRate = 60,
  maxBikes = 80,
  windowStart,
  windowEnd,
  onCursorAdvance,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const dprRef = useRef<number>(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)
  const playingCursorRef = useRef<number>(cursorTs)
  const lastFrameMsRef = useRef<number | null>(null)
  const lastNotifyMsRef = useRef<number>(0)

  // Refs the rAF loop reads from so it doesn't re-mount on every prop change.
  // Without this, the parent throttled cursor updates (4Hz) would tear down
  // and rebuild the loop 4x/sec — performance death.
  const cursorTsRef = useRef(cursorTs)
  const playingRef = useRef(playing)
  const playbackRateRef = useRef(playbackRate)
  const windowStartRef = useRef(windowStart)
  const windowEndRef = useRef(windowEnd)
  const onCursorAdvanceRef = useRef(onCursorAdvance)
  cursorTsRef.current = cursorTs
  playingRef.current = playing
  playbackRateRef.current = playbackRate
  windowStartRef.current = windowStart
  windowEndRef.current = windowEnd
  onCursorAdvanceRef.current = onCursorAdvance

  // Prepare polylines once per trips/routes/matrix change. Each prepared trip
  // carries the decoded polyline, its cumulative distance array, and the
  // color class. The rAF loop just interpolates + paints.
  const prepared = useMemo(() => prepareTrips(trips, routes, matrix), [trips, routes, matrix])
  const renderable = prepared.length > maxBikes ? prepared.slice(0, maxBikes) : prepared

  // Whenever the authoritative cursor jumps (scrubbing), sync the internal
  // playback cursor so playback resumes from the new position. We compare
  // against the internal cursor; if the parent's value matches our internal
  // (because we just told it to), this is a no-op so we don't fight ourselves.
  useEffect(() => {
    if (Math.abs(cursorTs - playingCursorRef.current) > 1) {
      playingCursorRef.current = cursorTs
      lastFrameMsRef.current = null
    }
  }, [cursorTs])

  // Resize the canvas to match the map container; tracks pixel ratio so the
  // dots stay crisp on retina screens.
  useEffect(() => {
    if (!map) return
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
    }
    sync()
    map.on('resize', sync)
    return () => { map.off('resize', sync) }
  }, [map])

  // The animation loop. Reads from refs (playingCursorRef, renderable via
  // closure) and from the map's projection — does NOT call setState.
  useEffect(() => {
    if (!map) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const draw = (timeMs: number) => {
      const dpr = dprRef.current
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr)

      const isPlaying = playingRef.current
      let activeCursor = cursorTsRef.current
      if (isPlaying) {
        const last = lastFrameMsRef.current
        if (last !== null) {
          const dtSec = (timeMs - last) / 1000
          const wStart = windowStartRef.current
          const wEnd = windowEndRef.current
          let next = playingCursorRef.current + dtSec * playbackRateRef.current
          if (next >= wEnd) {
            // Wrap to windowStart for an endless loop. This is the
            // satisfying "watch the day cycle" behavior the spec wants.
            next = wStart + ((next - wStart) % Math.max(1, wEnd - wStart))
          }
          playingCursorRef.current = next
          activeCursor = next

          // Throttle parent notifications to ~4Hz; the canvas itself is the
          // smooth visual and React doesn't need 60 commits/sec.
          const notify = onCursorAdvanceRef.current
          if (notify && timeMs - lastNotifyMsRef.current > 250) {
            notify(next)
            lastNotifyMsRef.current = timeMs
          }
        }
        lastFrameMsRef.current = timeMs
      } else {
        lastFrameMsRef.current = null
        activeCursor = cursorTsRef.current
      }

      // Paint each renderable trip whose [departure, arrival] window covers
      // the active cursor. Includes a short fading trail (~3 dots behind).
      for (const p of renderable) {
        const { trip, poly, cum, color } = p
        if (trip.departure_ts > activeCursor) continue
        if (trip.arrival_ts < activeCursor) continue
        const f = tripFraction(activeCursor, trip.departure_ts, trip.arrival_ts)

        // Trail: draw a few dots at slightly earlier cursor times, fading.
        for (let i = TRAIL_STEPS; i > 0; i--) {
          const trailCursor = activeCursor - i * TRAIL_GAP_SEC
          if (trailCursor < trip.departure_ts) continue
          const tf = tripFraction(trailCursor, trip.departure_ts, trip.arrival_ts)
          const tll = interpolatePolyline(poly, cum, tf)
          const tpx = map.project(tll)
          ctx.globalAlpha = (1 - i / (TRAIL_STEPS + 1)) * 0.4
          ctx.fillStyle = color
          ctx.beginPath()
          ctx.arc(tpx.x, tpx.y, DOT_RADIUS * 0.7, 0, Math.PI * 2)
          ctx.fill()
        }

        const ll = interpolatePolyline(poly, cum, f)
        const px = map.project(ll)
        ctx.globalAlpha = 1
        // White disc behind the emoji — pure legibility halo, no color
        // signal. (The duration-vs-typical color still rides the trail dots
        // behind the bike, so the signal isn't lost.) A faint stroke keeps
        // the disc visible against light basemaps too.
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(px.x, px.y, BIKE_EMOJI_PX * 0.65, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)'
        ctx.lineWidth = 1
        ctx.stroke()
        // Bike emoji. textAlign/textBaseline center the glyph on (px.x, px.y);
        // font set per-frame because the canvas context resets after a resize.
        ctx.font = `${BIKE_EMOJI_PX}px -apple-system, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('🚴', px.x, px.y)
      }

      rafRef.current = window.requestAnimationFrame(draw)
    }

    rafRef.current = window.requestAnimationFrame(draw)

    // The rAF loop is self-perpetuating (re-queues at the end of every draw),
    // so it naturally repaints on every browser frame regardless of map
    // movement. We don't need to attach map.on('move') listeners — the next
    // frame already picks up the updated projection.

    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
    // Only re-mount the loop when the map instance or trip set changes —
    // everything else flows through refs. This is the entire reason the
    // canvas can keep 60fps during playback.
  }, [map, renderable])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      css={{
        position: 'absolute',
        inset: 0,
        // MapLibre imperatively appends its tile canvas to the same container
        // AFTER React mounts our canvas, so without z-index its paint sits on
        // top of ours and bikes are invisible. Stack above the map.
        zIndex: 5,
        pointerEvents: 'none',  // map keeps all interactions
      }}
    />
  )
}
