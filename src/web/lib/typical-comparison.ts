// Shared logic for the "Typical vs right now" comparison used in two places:
//
//   1. The big callout on /station/:id/details ("More bikes than typical…")
//   2. The pin-border ring on /live (#39) — green = above, amber = below
//
// Both surfaces compare the current bike count against the day-of-week +
// hour-of-day baseline emitted by compute-typicals. The same gating
// (3-day floor, 21-day dow filter) applies to both — keeping the threshold
// math here so it can't drift between the two views.

export type HourBucket = {
  hour: number
  bikes: number
  docks: number
  samples: number
}

export type TypicalProfile = {
  stationId: string
  hours: HourBucket[]
  currentHour: number
  currentDow: number
  daysCovered: number
  isDowFiltered: boolean
  label: string
  timezone: string
}

/** Minimum daysCovered before we'll show any comparison at all. */
export const MIN_DAYS_FOR_COMPARISON = 3
/** Minimum daysCovered before the dow-filtered profile kicks in. */
export const DOW_FILTER_THRESHOLD_DAYS = 21

/**
 * Verdict for a single station, comparing right-now bikes to the baseline
 * bucket for the current hour.
 *
 *   - `more`     — currentBikes is meaningfully above typical (green ring)
 *   - `fewer`    — currentBikes is meaningfully below typical (amber ring)
 *   - `average`  — within epsilon of typical (no ring)
 *   - `no-baseline` — the bucket exists but typical is zero, so any
 *                     comparison is meaningless (no ring)
 *   - `insufficient-data` — fewer than MIN_DAYS_FOR_COMPARISON days of
 *                     history; we don't have a baseline to compare against
 *                     yet (no ring)
 *   - `unavailable` — no profile at all (network error, station missing
 *                     from the typicals output, etc.) (no ring)
 */
export type TypicalVerdict =
  | 'more'
  | 'fewer'
  | 'average'
  | 'no-baseline'
  | 'insufficient-data'
  | 'unavailable'

export type TypicalComparison = {
  verdict: TypicalVerdict
  /**
   * Typical bike count for the current hour (rounded to 1dp at the UI layer
   * if needed). `null` when there's no baseline to compare against — i.e.
   * verdict is `unavailable`, `insufficient-data`, or `no-baseline`.
   */
  typical: number | null
  /**
   * Total days of history covered by the underlying profile. `null` when
   * verdict is `unavailable` (no profile at all). Useful for the details
   * page "X days of data so far" hint.
   */
  daysCovered: number | null
}

/**
 * Classify the current bike count against the typical baseline.
 *
 * Threshold logic mirrors the original inline implementation in
 * StationDetails so the details-page callout text doesn't change:
 *   - more  if currentBikes >= typical * 1.5
 *   - fewer if currentBikes <= typical * 0.5
 *           OR currentBikes <= max(1, typical - 3)
 *   - else average
 *
 * The "or typical - 3" branch catches small-station cases where the * 0.5
 * threshold would never trigger (e.g. typical 4 → 0.5x = 2; without the
 * minus-3 floor a station sitting at 1 bike wouldn't read as "fewer").
 */
export function classifyTypical(
  currentBikes: number,
  profile: TypicalProfile | null,
): TypicalComparison {
  if (!profile) {
    return { verdict: 'unavailable', typical: null, daysCovered: null }
  }
  if (profile.daysCovered < MIN_DAYS_FOR_COMPARISON) {
    return { verdict: 'insufficient-data', typical: null, daysCovered: profile.daysCovered }
  }
  const bucket = profile.hours[profile.currentHour]
  const typical = bucket && bucket.samples > 0 ? bucket.bikes : 0
  if (typical <= 0) {
    return { verdict: 'no-baseline', typical: null, daysCovered: profile.daysCovered }
  }
  if (currentBikes >= typical * 1.5) {
    return { verdict: 'more', typical, daysCovered: profile.daysCovered }
  }
  if (currentBikes <= typical * 0.5 || currentBikes <= Math.max(1, typical - 3)) {
    return { verdict: 'fewer', typical, daysCovered: profile.daysCovered }
  }
  return { verdict: 'average', typical, daysCovered: profile.daysCovered }
}

/** Map a verdict to the pin-ring tone, or `null` for verdicts that get no ring. */
export type RingTone = 'success' | 'warning'

export function ringToneFor(verdict: TypicalVerdict): RingTone | null {
  if (verdict === 'more') return 'success'
  if (verdict === 'fewer') return 'warning'
  return null
}
