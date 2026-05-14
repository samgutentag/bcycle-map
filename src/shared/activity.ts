import type { ActivityEvent, ActivityLog, Trip } from './types'

const DEFAULT_MAX_EVENTS = 200
const DEFAULT_MAX_TRIPS = 50

type StationBikes = { station_id: string; num_bikes_available: number }

/**
 * Diff per-station `num_bikes_available` between two snapshots, emitting
 * one event per station with a nonzero change. Stations only present in
 * one snapshot are ignored (treated as new/removed).
 */
export function detectEvents(prev: StationBikes[], curr: StationBikes[], ts: number): ActivityEvent[] {
  const prevById = new Map(prev.map(s => [s.station_id, s.num_bikes_available]))
  const events: ActivityEvent[] = []
  for (const s of curr) {
    const prevBikes = prevById.get(s.station_id)
    if (prevBikes === undefined) continue
    const delta = s.num_bikes_available - prevBikes
    if (delta < 0) {
      events.push({ ts, station_id: s.station_id, type: 'departure', delta: -delta })
    } else if (delta > 0) {
      events.push({ ts, station_id: s.station_id, type: 'arrival', delta })
    }
  }
  return events
}

export type TripTransitionResult = {
  inFlightFromStationId: string | null
  inFlightDepartureTs: number | null
  newTrip: Trip | null
}

/**
 * Naive trip pairing: rely on the system being momentarily empty (0 active
 * riders) so a single departure must correspond to the next single arrival.
 *
 * - "trip start" — prev=0, curr=1, this tick has exactly one event which is
 *   a departure of magnitude 1. Stash the departing station as in-flight.
 * - "trip end" — prev=1, curr=0, this tick has exactly one event which is
 *   an arrival of magnitude 1, and an in-flight departure exists. Pair them.
 * - Any other change cancels the in-flight pairing (multi-rider activity
 *   violates the "only 1 rider" assumption).
 *
 * When no events happen in the tick the in-flight state is preserved as-is
 * (a rider is still out, we're just waiting for them to dock).
 */
export function applyTripTransition(
  log: Pick<ActivityLog, 'inFlightFromStationId' | 'inFlightDepartureTs'>,
  events: ActivityEvent[],
  ts: number,
  prevActive: number,
  currActive: number,
): TripTransitionResult {
  if (events.length === 0) {
    return {
      inFlightFromStationId: log.inFlightFromStationId ?? null,
      inFlightDepartureTs: log.inFlightDepartureTs ?? null,
      newTrip: null,
    }
  }

  const isCleanStart =
    prevActive === 0 &&
    currActive === 1 &&
    events.length === 1 &&
    events[0]!.type === 'departure' &&
    events[0]!.delta === 1

  if (isCleanStart) {
    return {
      inFlightFromStationId: events[0]!.station_id,
      inFlightDepartureTs: ts,
      newTrip: null,
    }
  }

  const isCleanEnd =
    prevActive === 1 &&
    currActive === 0 &&
    events.length === 1 &&
    events[0]!.type === 'arrival' &&
    events[0]!.delta === 1 &&
    !!log.inFlightFromStationId &&
    typeof log.inFlightDepartureTs === 'number'

  if (isCleanEnd) {
    const trip: Trip = {
      departure_ts: log.inFlightDepartureTs!,
      arrival_ts: ts,
      from_station_id: log.inFlightFromStationId!,
      to_station_id: events[0]!.station_id,
      duration_sec: ts - log.inFlightDepartureTs!,
    }
    return {
      inFlightFromStationId: null,
      inFlightDepartureTs: null,
      newTrip: trip,
    }
  }

  // Any other movement violates the "only 1 rider" assumption — abandon pairing.
  return {
    inFlightFromStationId: null,
    inFlightDepartureTs: null,
    newTrip: null,
  }
}

/**
 * Apply a tick's outcome to the existing log: append events, append trip
 * if any, update in-flight markers, trim to size.
 */
export function appendTick(
  log: ActivityLog,
  events: ActivityEvent[],
  transition: TripTransitionResult,
  opts: { maxEvents?: number; maxTrips?: number } = {},
): ActivityLog {
  const maxEvents = opts.maxEvents ?? DEFAULT_MAX_EVENTS
  const maxTrips = opts.maxTrips ?? DEFAULT_MAX_TRIPS
  const newEvents = [...log.events, ...events]
  const newTrips = transition.newTrip ? [...log.trips, transition.newTrip] : log.trips
  return {
    events: newEvents.slice(-maxEvents),
    trips: newTrips.slice(-maxTrips),
    inFlightFromStationId: transition.inFlightFromStationId,
    inFlightDepartureTs: transition.inFlightDepartureTs,
  }
}

export function emptyActivityLog(): ActivityLog {
  return { events: [], trips: [], inFlightFromStationId: null, inFlightDepartureTs: null }
}

export function activityKey(systemId: string): string {
  return `system:${systemId}:activity`
}
