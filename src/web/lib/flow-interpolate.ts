/**
 * Interpolation helpers for the bike-flow animation.
 *
 * The polyline is the cached Google Directions overview, already decoded into
 * [lng, lat] pairs (see `src/shared/polyline.ts`). For animation we want a
 * position along the polyline as a fraction of *distance*, not vertex index —
 * vertex spacing varies wildly, so naive index interpolation would make bikes
 * lurch across long straightaways then crawl through dense corner clusters.
 *
 * All functions are pure for unit testing. They operate on the same coordinate
 * shape MapLibre uses ([lng, lat]).
 */

export type LngLat = [number, number]

/** Squared Euclidean distance in degree-space — cheap and monotonic in true
 * distance for the small spatial extent of one bike-share system. Don't use
 * this for cross-city distances; for a single city it's a fine proxy. */
function dist2(a: LngLat, b: LngLat): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  return dx * dx + dy * dy
}

function dist(a: LngLat, b: LngLat): number {
  return Math.sqrt(dist2(a, b))
}

/**
 * Precompute the cumulative-distance prefix sum of a polyline.
 * Result length is equal to the input length; index 0 is always 0.
 * Total polyline length is `cumDist[cumDist.length - 1]`.
 */
export function buildCumulativeDistance(poly: LngLat[]): number[] {
  if (poly.length === 0) return []
  const cum: number[] = new Array(poly.length)
  cum[0] = 0
  for (let i = 1; i < poly.length; i++) {
    cum[i] = cum[i - 1]! + dist(poly[i - 1]!, poly[i]!)
  }
  return cum
}

/**
 * Position along the polyline at fraction `t` in [0, 1] of total distance.
 * t <= 0 → first vertex. t >= 1 → last vertex. Empty polyline → [0, 0].
 */
export function interpolatePolyline(poly: LngLat[], cumDist: number[], t: number): LngLat {
  if (poly.length === 0) return [0, 0]
  if (poly.length === 1) return poly[0]!
  const total = cumDist[cumDist.length - 1]!
  if (total === 0 || t <= 0) return poly[0]!
  if (t >= 1) return poly[poly.length - 1]!

  const target = t * total

  // Binary search for the segment containing `target`. cumDist is monotone
  // non-decreasing, so lower_bound gives us the upper vertex of the segment.
  let lo = 0
  let hi = cumDist.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (cumDist[mid]! < target) lo = mid + 1
    else hi = mid
  }
  // `lo` is the first index with cumDist[lo] >= target. The segment runs
  // from lo-1 to lo. If lo === 0 (rare with t > 0), clamp.
  const upper = Math.max(1, lo)
  const lower = upper - 1
  const segStart = cumDist[lower]!
  const segEnd = cumDist[upper]!
  const segLen = segEnd - segStart
  const local = segLen === 0 ? 0 : (target - segStart) / segLen
  const a = poly[lower]!
  const b = poly[upper]!
  return [a[0] + (b[0] - a[0]) * local, a[1] + (b[1] - a[1]) * local]
}

/**
 * Fraction of a trip elapsed at `cursorTs`. Clamped to [0, 1]. Trips with
 * zero or negative duration return 0 (defensive — these shouldn't show up
 * but if they do we don't want NaN propagating into the canvas math).
 */
export function tripFraction(
  cursorTs: number,
  departureTs: number,
  arrivalTs: number,
): number {
  const span = arrivalTs - departureTs
  if (span <= 0) return 0
  const f = (cursorTs - departureTs) / span
  if (f < 0) return 0
  if (f > 1) return 1
  return f
}

/**
 * Classify a trip's observed duration vs the "typical" duration for that
 * station pair. Returns:
 *   'fast'    — observed at least 15% under typical
 *   'slow'    — observed at least 15% over typical
 *   'typical' — within ±15% of typical
 *   'unknown' — no matrix data for this pair
 *
 * 15% is a deliberately wide band — most route durations naturally vary
 * by ~10% based on light timing and rider speed, so a tighter band would
 * paint everything red or blue with no neutral middle.
 */
export type DurationClass = 'fast' | 'typical' | 'slow' | 'unknown'

export function classifyDuration(
  observedSec: number,
  typicalSec: number | null,
): DurationClass {
  if (typicalSec === null || typicalSec <= 0) return 'unknown'
  const ratio = observedSec / typicalSec
  if (ratio <= 0.85) return 'fast'
  if (ratio >= 1.15) return 'slow'
  return 'typical'
}
