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
  type LngLat,
} from '../lib/flow-interpolate'
import { type TravelMatrix } from '../hooks/useTravelMatrix'
import { isInGap, nextDepartureAfter, DEAD_AIR_LEAD_SEC } from '../lib/flow-window'

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
const BIKE_EMOJI_PX = 18    // glyph size for the 🚴 head-of-trail marker
const TRAIL_WIDTH_PX = 2.5  // stroke width of the growing route trail
const TRAIL_ALPHA = 0.55    // opacity of the route trail while bike is alive
const TRAIL_COLOR = '#0d6cb0'  // single brand-accent color (sky blue) for every trail
/**
 * Seconds the trail lingers + fades after the bike arrives. During this
 * window the trail still draws at the full polyline length but at
 * monotonically decreasing alpha; the bike emoji is dropped immediately
 * on arrival because the ride is over. Re-exported so FlowMap can extend
 * `selectVisibleTrips` to include trips up to this many seconds past
 * their arrival_ts.
 */
export const TRAIL_GHOST_FADE_SEC = 30

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
  /** Window end — outer bound of the scrubber (typically "now"). */
  windowEnd: number
  /** Window start — outer bound of the scrubber (typically now − 24h). */
  windowStart: number
  /**
   * Playback loop bounds. When set, the rAF wrap math uses these instead
   * of [windowStart, windowEnd] so playback can loop tight to the active
   * trip cluster rather than wrap through hours of dead air. Manual
   * scrubbing still walks the full window — these bounds only affect the
   * cursor advance during playback. Defaults to [windowStart, windowEnd].
   */
  playbackLoopStart?: number
  playbackLoopEnd?: number
  /** Called with the cursor's new value during playback so the parent can keep
   * its state in rough sync (we throttle internally to ~4Hz to avoid React
   * re-render storms; full smoothness is provided by the canvas itself). */
  onCursorAdvance?: (ts: number) => void
  /**
   * Full unfiltered trip list used by the skip-the-gaps gap detection (#56).
   * The `trips` prop is the visible-at-cursor subset (parent already filtered
   * via selectVisibleTrips for rendering). Gap detection needs the broader
   * set: when the cursor sits outside any active trip — common right after
   * pressing play with cursor at "now" past all trip arrivals — the gap
   * check has to look at the FULL list to find the next departure to jump
   * to, or it'll infinite-loop at loopStart. Falls back to `trips` when not
   * supplied so existing callers stay functional.
   */
  allTrips?: Trip[]
  /** Override the ghost trail fade duration (seconds). Defaults to
   *  TRAIL_GHOST_FADE_SEC (30s). Pool mode uses a shorter value so
   *  trails don't linger across the compressed timeline. */
  ghostFadeSec?: number
}

function prepareTrips(
  trips: Trip[],
  routes: RouteCache | null,
  // matrix kept on the signature for future use (e.g. a re-introduced
  // speed signal). Currently unused — trail color is a single brand
  // accent so the canvas stays readable when many bikes overlap.
  _matrix: TravelMatrix | null,
): PreparedTrip[] {
  if (!routes) return []
  const out: PreparedTrip[] = []
  for (const trip of trips) {
    const edge = lookupRoute(routes, trip.from_station_id, trip.to_station_id)
    if (!edge) continue
    const poly = decodePolyline(edge.polyline)
    if (poly.length < 2) continue
    const cum = buildCumulativeDistance(poly)
    out.push({ trip, poly, cum, color: TRAIL_COLOR })
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
  playbackRate = 1440,
  maxBikes = 80,
  windowStart,
  windowEnd,
  playbackLoopStart,
  playbackLoopEnd,
  onCursorAdvance,
  allTrips,
  ghostFadeSec: ghostFadeSecProp,
}: Props) {
  const ghostFadeSec = ghostFadeSecProp ?? TRAIL_GHOST_FADE_SEC
  // Gap detection (#56) uses the full trip list. When the parent doesn't
  // supply one, fall back to the visible-at-cursor `trips` subset —
  // backward-compat for any caller that pre-dates this prop.
  const gapTrips = allTrips ?? trips
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
  const playbackLoopStartRef = useRef<number | undefined>(playbackLoopStart)
  const playbackLoopEndRef = useRef<number | undefined>(playbackLoopEnd)
  const onCursorAdvanceRef = useRef(onCursorAdvance)
  const ghostFadeSecRef = useRef(ghostFadeSec)
  cursorTsRef.current = cursorTs
  ghostFadeSecRef.current = ghostFadeSec
  playingRef.current = playing
  playbackRateRef.current = playbackRate
  windowStartRef.current = windowStart
  windowEndRef.current = windowEnd
  playbackLoopStartRef.current = playbackLoopStart
  playbackLoopEndRef.current = playbackLoopEnd
  onCursorAdvanceRef.current = onCursorAdvance

  // Sorted departure timestamps used by skip-the-gaps playback (#56). Built
  // from the full unfiltered trip list (`gapTrips`) — not from the visible-
  // at-cursor `trips` — so the gap check can find a "next departure" even
  // when the cursor sits outside any currently-visible trip. Kept in refs
  // so the rAF loop reads the latest values without re-mounting.
  const sortedDepartures = useMemo(
    () => gapTrips.map(t => t.departure_ts).sort((a, b) => a - b),
    [gapTrips],
  )
  const gapTripsRef = useRef<Trip[]>(gapTrips)
  const sortedDeparturesRef = useRef<number[]>(sortedDepartures)
  gapTripsRef.current = gapTrips
  sortedDeparturesRef.current = sortedDepartures

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
          // Playback loop bounds — tight to the active trip cluster when
          // the parent supplies them, otherwise fall back to the full
          // window. This is the "always animating" optimization: skip the
          // hours of dead air on quiet days while still letting manual
          // scrubbing walk the full 24h window.
          const loopStart = playbackLoopStartRef.current ?? windowStartRef.current
          const loopEnd = playbackLoopEndRef.current ?? windowEndRef.current
          let next = playingCursorRef.current + dtSec * playbackRateRef.current
          if (next < loopStart) {
            // Cursor was outside the playback loop (user scrubbed to a dead
            // gap then hit play). Snap into the loop so the next frame
            // shows action immediately.
            next = loopStart
          } else if (next >= loopEnd) {
            // Wrap to loopStart. Stays in the busy window forever, which
            // is the satisfying "watch the day cycle" behavior on quiet
            // days when most of the 24h would otherwise be empty.
            next = loopStart + ((next - loopStart) % Math.max(1, loopEnd - loopStart))
          }

          // Skip-the-gaps (#56): if the cursor lands in a >5min trip-free
          // stretch, fast-forward to the next departure (or wrap to the
          // loop start if no later departure exists). Manual scrubbing is
          // unaffected — only playback advances trigger this. The
          // playbackLoop bounds already trimmed the lead-in / lead-out
          // dead air, so this only fires for gaps BETWEEN trip clusters.
          if (isInGap(gapTripsRef.current, sortedDeparturesRef.current, next, DEAD_AIR_LEAD_SEC)) {
            const upcoming = nextDepartureAfter(sortedDeparturesRef.current, next)
            // Jump to the next departure if there is one and it's inside
            // the playback loop. Otherwise wrap to loopStart so playback
            // restarts the busy cluster from the top.
            if (upcoming !== null && upcoming < loopEnd) {
              next = upcoming
            } else {
              next = loopStart
            }
            // No explicit lastFrameMsRef resync needed — line below sets it
            // to timeMs unconditionally on every frame, so the next dt is
            // measured from THIS frame, not the pre-jump cursor position.
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

        // "Ghost" mode: trip already arrived but we keep the trail visible
        // for a short fade-out window so completed rides don't pop out of
        // existence. The bike emoji is dropped on arrival (ride's over),
        // and trail alpha decays linearly across the ghost window.
        const ghostElapsed = activeCursor - trip.arrival_ts
        const fade = ghostFadeSecRef.current
        if (ghostElapsed > fade) continue
        const isGhost = ghostElapsed > 0
        const ghostAlphaMul = isGhost ? Math.max(0, 1 - ghostElapsed / fade) : 1

        const f = tripFraction(activeCursor, trip.departure_ts, trip.arrival_ts)

        // Trail: draw a few dots at slightly earlier cursor times, fading.
        // Growing trail: solid polyline from the departure point along the
        // route up to the bike's current position. Replaces the older fading
        // dot trail — easier to read at a glance, especially when several
        // overlapping trips share a corridor. Stroke color carries the
        // duration-vs-typical signal.
        const ll = interpolatePolyline(poly, cum, f)
        const px = map.project(ll)
        const total = cum[cum.length - 1] ?? 0
        if (total > 0 && f > 0) {
          const target = f * total
          ctx.globalAlpha = TRAIL_ALPHA * ghostAlphaMul
          ctx.strokeStyle = color
          ctx.lineWidth = TRAIL_WIDTH_PX
          ctx.lineCap = 'round'
          ctx.lineJoin = 'round'
          ctx.beginPath()
          const p0 = map.project(poly[0] as [number, number])
          ctx.moveTo(p0.x, p0.y)
          // Walk forward through vertices, drawing each segment fully until
          // the cumulative distance crosses `target`. The last segment ends
          // at the bike's exact interpolated position so the trail tip
          // visually meets the emoji.
          for (let i = 1; i < poly.length; i++) {
            if (cum[i]! >= target) {
              ctx.lineTo(px.x, px.y)
              break
            }
            const pPx = map.project(poly[i] as [number, number])
            ctx.lineTo(pPx.x, pPx.y)
          }
          ctx.stroke()
        }
        // Ride's over — trail keeps fading but no bike on the canvas.
        if (isGhost) continue

        ctx.globalAlpha = 1
        // White disc behind the emoji — pure legibility halo against
        // dark base layers and the colored trail. Faint stroke keeps the
        // disc visible against light basemaps too.
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
