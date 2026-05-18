import type { StationSnapshot } from '@shared/types'

/**
 * Filter values for the `/live` chip row. All defaults represent "no filter".
 *
 * - `minBikes`: only show stations with `num_bikes_available >= minBikes`.
 *   `0` means no minimum (the "Any" chip state).
 * - `offlineOnly`: when true, only show stations that are offline in some
 *   way — `is_renting === false`, `is_returning === false`, or
 *   `is_installed === false`. False means no offline filtering.
 */
export type MapFilters = {
  minBikes: number
  offlineOnly: boolean
}

/** The cycle that the Min Bikes chip steps through on each click. */
export const MIN_BIKES_CYCLE = [0, 1, 3, 5] as const

export const DEFAULT_FILTERS: MapFilters = {
  minBikes: 0,
  offlineOnly: false,
}

export function isStationOffline(s: StationSnapshot): boolean {
  return !s.is_renting || !s.is_returning || !s.is_installed
}

/**
 * Returns a new array containing only the stations that pass every active
 * filter. With default filters this is a shallow copy of the input — safe to
 * hand off without worrying about reference identity with the underlying
 * snapshot.
 */
export function applyMapFilters(
  stations: StationSnapshot[],
  filters: MapFilters,
): StationSnapshot[] {
  return stations.filter(s => {
    if (filters.minBikes > 0 && s.num_bikes_available < filters.minBikes) return false
    if (filters.offlineOnly && !isStationOffline(s)) return false
    return true
  })
}

/**
 * Step the Min Bikes chip forward through its cycle (Any → 1+ → 3+ → 5+ → Any).
 * Falls back to the start if the current value isn't a known step.
 */
export function nextMinBikes(current: number): number {
  const idx = MIN_BIKES_CYCLE.indexOf(current as (typeof MIN_BIKES_CYCLE)[number])
  if (idx === -1) return MIN_BIKES_CYCLE[0]
  return MIN_BIKES_CYCLE[(idx + 1) % MIN_BIKES_CYCLE.length] ?? MIN_BIKES_CYCLE[0]
}

/**
 * Parse `MapFilters` from URL search params. Defaults applied for missing,
 * malformed, or unknown values — never throws.
 *
 * Recognized keys:
 *   - `bikes`: integer; coerced into the nearest known step in
 *     `MIN_BIKES_CYCLE` (e.g. `?bikes=2` → 1+). Out-of-range values clamp to 0.
 *   - `offline`: `1` enables the offline-only filter; anything else disables.
 */
export function readFiltersFromSearch(params: URLSearchParams): MapFilters {
  const rawBikes = params.get('bikes')
  const parsedBikes = rawBikes == null ? 0 : Number.parseInt(rawBikes, 10)
  const minBikes = Number.isFinite(parsedBikes)
    ? clampMinBikes(parsedBikes)
    : 0
  const offlineOnly = params.get('offline') === '1'
  return { minBikes, offlineOnly }
}

/** Round an arbitrary integer to the largest step in MIN_BIKES_CYCLE <= value. */
function clampMinBikes(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  let best = 0
  for (const step of MIN_BIKES_CYCLE) {
    if (step <= value && step > best) best = step
  }
  return best
}

/**
 * Mutate a copy of `params` to reflect the given filters. Default values are
 * removed from the URL so the canonical "no filters" URL has no query string.
 */
export function writeFiltersToSearch(
  params: URLSearchParams,
  filters: MapFilters,
): URLSearchParams {
  const next = new URLSearchParams(params)
  if (filters.minBikes > 0) next.set('bikes', String(filters.minBikes))
  else next.delete('bikes')
  if (filters.offlineOnly) next.set('offline', '1')
  else next.delete('offline')
  return next
}

export function hasActiveFilter(filters: MapFilters): boolean {
  return filters.minBikes > 0 || filters.offlineOnly
}
