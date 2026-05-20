import type { Trip } from '@shared/types'

/**
 * Trips visible at a given cursor time: any trip whose [departure_ts,
 * arrival_ts + ghostSec] window covers the cursor. Trips at the exact
 * boundary are considered visible.
 *
 * `ghostSec` (default 0) extends the visible window past arrival so the
 * caller can render a fading "trail lingers" effect after the ride ends.
 * The caller is responsible for distinguishing alive trips
 * (cursor <= arrival_ts) from ghost trips (cursor > arrival_ts).
 */
export function selectVisibleTrips(trips: Trip[], cursorTs: number, ghostSec = 0): Trip[] {
  return trips.filter(t => t.departure_ts <= cursorTs && cursorTs <= t.arrival_ts + ghostSec)
}

/**
 * Cap the visible-trips list to a maximum count by taking the longest-duration
 * trips first (so the cap doesn't visually strip the most interesting commute
 * paths). Returns the trimmed list plus the original count for a
 * "showing X of Y" caption. If the trips already fit, returns them as-is.
 */
export function capTripsForRender(trips: Trip[], maxCount: number): {
  rendered: Trip[]
  totalCount: number
} {
  if (trips.length <= maxCount) {
    return { rendered: trips, totalCount: trips.length }
  }
  // Sort a copy by duration descending — long trips are still in-frame longer,
  // which gives the eye more time to register them on each pass.
  const sorted = trips.slice().sort((a, b) => b.duration_sec - a.duration_sec)
  return { rendered: sorted.slice(0, maxCount), totalCount: trips.length }
}
