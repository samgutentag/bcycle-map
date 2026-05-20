import type { Trip } from '@shared/types'

/**
 * Helpers for /flow's dead-air compression (#56):
 *
 *  - `computeDynamicWindow` shrinks the scrubber to
 *    `[max(now-24h, oldestTripDeparture - 5min), now]` so quiet days don't
 *    show 22 hours of empty scrubber.
 *  - `nextDepartureAfter` and `isInGap` drive the skip-the-gaps playback
 *    fast-forward in BikeAnimationLayer.
 *
 * Pure functions — kept here (rather than inside FlowMap or
 * BikeAnimationLayer) so they can be unit-tested without React.
 */

/** Hard ceiling on how far back the scrubber will ever look. */
export const MAX_WINDOW_SEC = 24 * 3600
/** Lead-in before the oldest trip on a quiet day, so the cursor has room to
 * sit before the first bike appears. Doubles as the gap-detection threshold
 * for skip-the-gaps playback — a stretch of empty time longer than this is
 * "dead air" worth skipping. */
export const DEAD_AIR_LEAD_SEC = 5 * 60

export type FlowWindow = {
  windowStart: number
  windowEnd: number
}

/**
 * Pick the scrubber bounds for a given trip set + "now".
 *
 *  - With no trips, returns the full 24h window so the scrubber still has a
 *    real range to render (the no-trips caption handles the messaging).
 *  - With trips clustered in the recent past, returns the tightest window
 *    that still gives DEAD_AIR_LEAD_SEC of lead-in before the oldest trip.
 *  - Never goes further back than `now - MAX_WINDOW_SEC` — the underlying
 *    fetch only sees a 24h window so we can't honestly render older data
 *    even if a trip somehow reported a stale departure_ts.
 */
export function computeDynamicWindow(trips: Trip[], nowSec: number): FlowWindow {
  const fullWindowStart = nowSec - MAX_WINDOW_SEC
  if (trips.length === 0) {
    return { windowStart: fullWindowStart, windowEnd: nowSec }
  }
  let oldest = Infinity
  for (const t of trips) {
    if (t.departure_ts < oldest) oldest = t.departure_ts
  }
  const tightStart = oldest - DEAD_AIR_LEAD_SEC
  // max(fullWindowStart, tightStart) — never reach further back than 24h,
  // never start later than DEAD_AIR_LEAD_SEC before the oldest trip.
  const windowStart = tightStart > fullWindowStart ? tightStart : fullWindowStart
  return { windowStart, windowEnd: nowSec }
}

/**
 * Pick a tick interval (in seconds) for the scrubber based on the window
 * span. Goal: render between ~4 and ~10 ticks regardless of how wide the
 * window is, so a 2h dynamic window doesn't end up with a single tick and
 * the full 24h doesn't get crowded with 96 of them.
 *
 *  - ≤  1h → 15min ticks  (4 ticks)
 *  - ≤  4h → 30min ticks  (4–8 ticks)
 *  - ≤  8h → 1h ticks    (4–8 ticks)
 *  - ≤ 16h → 2h ticks    (4–8 ticks)
 *  - > 16h → 3h ticks    (6–8 ticks for the full 24h)
 */
export function pickTickInterval(spanSec: number): number {
  if (spanSec <= 1 * 3600) return 15 * 60
  if (spanSec <= 4 * 3600) return 30 * 60
  if (spanSec <= 8 * 3600) return 60 * 60
  if (spanSec <= 16 * 3600) return 2 * 3600
  return 3 * 3600
}

/**
 * Find the first trip departure strictly after `cursorTs` in a sorted array.
 * Returns `null` if no later departure exists. Linear scan because the
 * activity log caps at ~50 trips system-wide — sub-microsecond either way.
 */
export function nextDepartureAfter(
  sortedDepartures: number[],
  cursorTs: number,
): number | null {
  for (const ts of sortedDepartures) {
    if (ts > cursorTs) return ts
  }
  return null
}

/**
 * Returns true when the cursor sits in a >gapSec stretch with no active
 * trip and the next departure is more than gapSec away. Skip-the-gaps
 * playback uses this to decide whether to fast-forward.
 *
 *  - If a trip is currently active (departure ≤ cursor ≤ arrival), not a gap.
 *  - If the next departure is within gapSec, not a gap (we'll be back in
 *    action soon enough; jumping would feel jittery).
 *  - If no future departure exists at all, treat as a gap so the caller can
 *    decide to wrap the cursor. (Skip-the-gaps callers in practice fall back
 *    to playbackLoopStart when nextDeparture is null.)
 */
export function isInGap(
  trips: Trip[],
  sortedDepartures: number[],
  cursorTs: number,
  gapSec: number = DEAD_AIR_LEAD_SEC,
): boolean {
  for (const t of trips) {
    if (t.departure_ts <= cursorTs && cursorTs <= t.arrival_ts) return false
  }
  const next = nextDepartureAfter(sortedDepartures, cursorTs)
  if (next === null) return true
  return next - cursorTs > gapSec
}
