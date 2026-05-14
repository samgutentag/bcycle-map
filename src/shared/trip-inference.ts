import type { ActivityEvent, Trip } from './types'

export type SimpleEdge = { minutes: number; meters: number }
export type SimpleMatrix = Record<string, Record<string, SimpleEdge>>

const MIN_RATIO = 0.3   // observed duration < 30% of expected → implausibly short
const MAX_RATIO = 4.0   // observed > 4x expected → rider stopped somewhere, drop
const MIN_DURATION_SEC = 60      // anything shorter than 1 min is noise
const MAX_DURATION_SEC = 60 * 90 // anything longer than 90 min isn't a single trip

type Candidate = { ts: number; station_id: string }

function tripKey(t: Pick<Trip, 'departure_ts' | 'arrival_ts' | 'from_station_id' | 'to_station_id'>): string {
  return `${t.departure_ts}|${t.arrival_ts}|${t.from_station_id}|${t.to_station_id}`
}

/**
 * Expand an event with delta>1 into delta separate single-bike candidates,
 * all at the same timestamp + station. This loses ordering between bikes
 * within the same tick, which is unavoidable at the 2-minute sample rate.
 */
function expand(e: ActivityEvent): Candidate[] {
  return Array.from({ length: e.delta }, () => ({ ts: e.ts, station_id: e.station_id }))
}

/**
 * Walk events chronologically. For each arrival, pick the unpaired
 * departure whose duration most closely matches the travel-time matrix
 * for that origin → destination pair. Filter out implausible pairings.
 *
 * Departures and arrivals appearing inside `existingTrips` are
 * considered already paired and skipped — re-running is safe and the
 * same trip won't be paired twice.
 */
export function inferTrips(
  events: ActivityEvent[],
  matrix: SimpleMatrix,
  existingTrips: Trip[] = [],
): Trip[] {
  // Build "consumed" sets: any (ts, station_id) pair that's part of an
  // existing trip's departure or arrival is off-limits for fresh inference.
  // We track per-pair consumption count so events with delta>1 stay
  // available for the remaining riders.
  const consumedDepartures = new Map<string, number>()
  const consumedArrivals = new Map<string, number>()
  for (const t of existingTrips) {
    const dKey = `${t.departure_ts}|${t.from_station_id}`
    const aKey = `${t.arrival_ts}|${t.to_station_id}`
    consumedDepartures.set(dKey, (consumedDepartures.get(dKey) ?? 0) + 1)
    consumedArrivals.set(aKey, (consumedArrivals.get(aKey) ?? 0) + 1)
  }

  const sorted = [...events].sort((a, b) => a.ts - b.ts)
  const unpairedDepartures: Candidate[] = []
  const newTrips: Trip[] = []
  const seenNewTripKeys = new Set<string>()

  for (const e of sorted) {
    let available = e.delta
    if (e.type === 'departure') {
      const dKey = `${e.ts}|${e.station_id}`
      const consumed = consumedDepartures.get(dKey) ?? 0
      available -= consumed
      if (consumed > 0) consumedDepartures.set(dKey, 0)
      for (const c of expand({ ...e, delta: Math.max(0, available) })) unpairedDepartures.push(c)
      continue
    }

    // Arrival: try to consume each delta-1 unit against the unpaired pool.
    const aKey = `${e.ts}|${e.station_id}`
    const aConsumed = consumedArrivals.get(aKey) ?? 0
    available -= aConsumed
    if (aConsumed > 0) consumedArrivals.set(aKey, 0)

    for (let n = 0; n < available; n++) {
      let bestIdx = -1
      let bestScore = Number.POSITIVE_INFINITY
      for (let i = 0; i < unpairedDepartures.length; i++) {
        const d = unpairedDepartures[i]!
        const durationSec = e.ts - d.ts
        if (durationSec < MIN_DURATION_SEC || durationSec > MAX_DURATION_SEC) continue
        const edge = matrix[d.station_id]?.[e.station_id]
        if (!edge) continue  // no route info — skip rather than guess
        const expectedSec = edge.minutes * 60
        if (expectedSec <= 0) continue
        const ratio = durationSec / expectedSec
        if (ratio < MIN_RATIO || ratio > MAX_RATIO) continue
        const score = Math.abs(durationSec - expectedSec)
        if (score < bestScore) {
          bestScore = score
          bestIdx = i
        }
      }
      if (bestIdx < 0) continue
      const match = unpairedDepartures.splice(bestIdx, 1)[0]!
      const trip: Trip = {
        departure_ts: match.ts,
        arrival_ts: e.ts,
        from_station_id: match.station_id,
        to_station_id: e.station_id,
        duration_sec: e.ts - match.ts,
      }
      const k = tripKey(trip)
      if (seenNewTripKeys.has(k)) continue
      seenNewTripKeys.add(k)
      newTrips.push(trip)
    }
  }
  return newTrips
}
