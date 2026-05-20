/**
 * Imperial / metric formatting helpers for distance + speed (#16).
 *
 * The worker always returns distances in meters and speeds in meters per
 * second — only the rendering switches. Pair these with `useUnitSystem()`
 * so call sites stay reactive to the user's persisted preference.
 *
 * Thresholds:
 *   - imperial distance: below 0.1 mi (~161 m) renders feet rounded to
 *     the nearest 10 ft; at or above renders miles to one decimal
 *   - metric distance: below 1.0 km renders meters rounded to the nearest
 *     10 m; at or above renders km to one decimal
 *
 * Defensive: non-finite or negative inputs collapse to "0 ft" / "0 m"
 * (and "0 mph" / "0 km/h") rather than producing NaN strings.
 */

export type UnitSystem = 'imperial' | 'metric'

export const DEFAULT_UNIT_SYSTEM: UnitSystem = 'imperial'

const METERS_PER_FOOT = 0.3048
const METERS_PER_MILE = 1609.344
const SECONDS_PER_HOUR = 3600

function safeMeters(meters: number): number {
  if (!Number.isFinite(meters) || meters < 0) return 0
  return meters
}

function safeMetersPerSec(metersPerSec: number): number {
  if (!Number.isFinite(metersPerSec) || metersPerSec < 0) return 0
  return metersPerSec
}

function formatImperialDistance(meters: number): string {
  const mi = meters / METERS_PER_MILE
  if (mi < 0.1) {
    const ft = Math.round(meters / METERS_PER_FOOT / 10) * 10
    return `${ft} ft`
  }
  return `${mi.toFixed(1)} mi`
}

function formatMetricDistance(meters: number): string {
  const km = meters / 1000
  if (km < 1) {
    const m = Math.round(meters / 10) * 10
    return `${m} m`
  }
  return `${km.toFixed(1)} km`
}

export function formatDistance(meters: number, unitSystem: UnitSystem): string {
  const safe = safeMeters(meters)
  return unitSystem === 'metric'
    ? formatMetricDistance(safe)
    : formatImperialDistance(safe)
}

export function formatSpeed(metersPerSec: number, unitSystem: UnitSystem): string {
  const safe = safeMetersPerSec(metersPerSec)
  if (unitSystem === 'metric') {
    const kmh = (safe * SECONDS_PER_HOUR) / 1000
    return `${Math.round(kmh)} km/h`
  }
  const mph = (safe * SECONDS_PER_HOUR) / METERS_PER_MILE
  return `${Math.round(mph)} mph`
}
