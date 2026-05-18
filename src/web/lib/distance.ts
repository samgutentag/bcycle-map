/**
 * Geo helpers for the "where's a bike near me" mode on /live.
 *
 * The live map only needs straight-line ("as the crow flies") distances —
 * Google Distance Matrix is reserved for the gated travel-times pipeline, so
 * client-side sorting uses haversine on the WGS84 lat/lon pairs we already
 * ship in every snapshot. Accurate to within ~0.5% for the few-km radius
 * the nearby-stations sheet cares about.
 */

const EARTH_RADIUS_M = 6_371_000

type LatLon = { lat: number; lon: number }

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180
}

/**
 * Great-circle distance in meters between two lat/lon points using the
 * haversine formula. Symmetric in its inputs.
 */
export function haversineMeters(a: LatLon, b: LatLon): number {
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)
  const dLat = toRadians(b.lat - a.lat)
  const dLon = toRadians(b.lon - a.lon)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
  return EARTH_RADIUS_M * c
}

const METERS_PER_FOOT = 0.3048
const METERS_PER_MILE = 1609.344
// 1000 ft ≈ 304.8 m — the crossover from "feet" labels to "miles" labels.
const FEET_MILE_CROSSOVER_M = 1000 * METERS_PER_FOOT

/**
 * Format a walking distance for a US audience.
 * - Under ~1000 ft: rounded to nearest 10 ft (e.g. "420 ft")
 * - Otherwise: miles with one decimal (e.g. "0.4 mi"), or two decimals
 *   below 0.1 mi for very short distances so we don't show "0.0 mi"
 */
export function formatWalkingDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return ''
  if (meters < FEET_MILE_CROSSOVER_M) {
    const feet = Math.round(meters / METERS_PER_FOOT / 10) * 10
    return `${feet} ft`
  }
  const miles = meters / METERS_PER_MILE
  const rounded = miles < 0.1 ? miles.toFixed(2) : miles.toFixed(1)
  return `${rounded} mi`
}

/** 0.5 mi in meters — the default nearby-stations search radius. */
export const HALF_MILE_M = 0.5 * METERS_PER_MILE
/** 1 mi in meters — the widened fallback radius when nothing is within 0.5 mi. */
export const ONE_MILE_M = METERS_PER_MILE
