import { describe, it, expect } from 'vitest'
import {
  detectEvents,
  applyTripTransition,
  appendTick,
  emptyActivityLog,
  activityKey,
} from './activity'

describe('detectEvents', () => {
  it('emits a departure when a station loses bikes', () => {
    const events = detectEvents(
      [{ station_id: 'a', num_bikes_available: 5 }],
      [{ station_id: 'a', num_bikes_available: 3 }],
      100,
    )
    expect(events).toEqual([{ ts: 100, station_id: 'a', type: 'departure', delta: 2 }])
  })

  it('emits an arrival when a station gains bikes', () => {
    const events = detectEvents(
      [{ station_id: 'a', num_bikes_available: 3 }],
      [{ station_id: 'a', num_bikes_available: 5 }],
      100,
    )
    expect(events).toEqual([{ ts: 100, station_id: 'a', type: 'arrival', delta: 2 }])
  })

  it('emits nothing for unchanged stations', () => {
    expect(detectEvents(
      [{ station_id: 'a', num_bikes_available: 3 }],
      [{ station_id: 'a', num_bikes_available: 3 }],
      100,
    )).toEqual([])
  })

  it('emits one event per changed station', () => {
    const events = detectEvents(
      [
        { station_id: 'a', num_bikes_available: 5 },
        { station_id: 'b', num_bikes_available: 2 },
        { station_id: 'c', num_bikes_available: 7 },
      ],
      [
        { station_id: 'a', num_bikes_available: 4 },  // -1 departure
        { station_id: 'b', num_bikes_available: 2 },  // unchanged
        { station_id: 'c', num_bikes_available: 8 },  // +1 arrival
      ],
      100,
    )
    expect(events).toHaveLength(2)
    expect(events.find(e => e.station_id === 'a')?.type).toBe('departure')
    expect(events.find(e => e.station_id === 'c')?.type).toBe('arrival')
  })

  it('ignores stations only present in one snapshot', () => {
    const events = detectEvents(
      [{ station_id: 'a', num_bikes_available: 5 }],
      [
        { station_id: 'a', num_bikes_available: 5 },
        { station_id: 'b', num_bikes_available: 3 },  // new station
      ],
      100,
    )
    expect(events).toEqual([])
  })
})

describe('applyTripTransition', () => {
  const baseLog = { inFlightFromStationId: null, inFlightDepartureTs: null }

  it('marks an in-flight start on a clean 0→1 single departure', () => {
    const result = applyTripTransition(
      baseLog,
      [{ ts: 100, station_id: 'a', type: 'departure', delta: 1 }],
      100, 0, 1,
    )
    expect(result.inFlightFromStationId).toBe('a')
    expect(result.inFlightDepartureTs).toBe(100)
    expect(result.newTrip).toBeNull()
  })

  it('completes a trip on a clean 1→0 single arrival when an in-flight exists', () => {
    const result = applyTripTransition(
      { inFlightFromStationId: 'a', inFlightDepartureTs: 100 },
      [{ ts: 200, station_id: 'b', type: 'arrival', delta: 1 }],
      200, 1, 0,
    )
    expect(result.newTrip).toEqual({
      departure_ts: 100,
      arrival_ts: 200,
      from_station_id: 'a',
      to_station_id: 'b',
      duration_sec: 100,
    })
    expect(result.inFlightFromStationId).toBeNull()
    expect(result.inFlightDepartureTs).toBeNull()
  })

  it('preserves in-flight when no events occur (rider still out)', () => {
    const result = applyTripTransition(
      { inFlightFromStationId: 'a', inFlightDepartureTs: 100 },
      [],
      200, 1, 1,
    )
    expect(result.inFlightFromStationId).toBe('a')
    expect(result.inFlightDepartureTs).toBe(100)
    expect(result.newTrip).toBeNull()
  })

  it('cancels pairing on a multi-station tick (violates "1 rider" assumption)', () => {
    const result = applyTripTransition(
      { inFlightFromStationId: 'a', inFlightDepartureTs: 100 },
      [
        { ts: 200, station_id: 'b', type: 'arrival', delta: 1 },
        { ts: 200, station_id: 'c', type: 'departure', delta: 1 },
      ],
      200, 1, 1,
    )
    expect(result.newTrip).toBeNull()
    expect(result.inFlightFromStationId).toBeNull()
  })

  it('cancels pairing on a delta-2 departure (multiple riders left at once)', () => {
    const result = applyTripTransition(
      baseLog,
      [{ ts: 100, station_id: 'a', type: 'departure', delta: 2 }],
      100, 0, 2,
    )
    expect(result.newTrip).toBeNull()
    expect(result.inFlightFromStationId).toBeNull()
  })

  it('does not start a trip when prev active was already > 0', () => {
    const result = applyTripTransition(
      baseLog,
      [{ ts: 100, station_id: 'a', type: 'departure', delta: 1 }],
      100, 2, 3,
    )
    expect(result.inFlightFromStationId).toBeNull()
    expect(result.newTrip).toBeNull()
  })

  it('does not complete a trip when no in-flight start was recorded', () => {
    const result = applyTripTransition(
      baseLog,
      [{ ts: 200, station_id: 'b', type: 'arrival', delta: 1 }],
      200, 1, 0,
    )
    expect(result.newTrip).toBeNull()
  })
})

describe('appendTick', () => {
  it('appends events and trip and updates in-flight', () => {
    const log = emptyActivityLog()
    const events = [{ ts: 100, station_id: 'a', type: 'departure' as const, delta: 1 }]
    const transition = { inFlightFromStationId: 'a', inFlightDepartureTs: 100, newTrip: null }
    const next = appendTick(log, events, transition)
    expect(next.events).toEqual(events)
    expect(next.trips).toEqual([])
    expect(next.inFlightFromStationId).toBe('a')
  })

  it('trims events to maxEvents (FIFO)', () => {
    const log = {
      events: Array.from({ length: 200 }, (_, i) => ({
        ts: i, station_id: `s${i}`, type: 'departure' as const, delta: 1,
      })),
      trips: [],
      inFlightFromStationId: null,
      inFlightDepartureTs: null,
    }
    const newEvents = [{ ts: 999, station_id: 'new', type: 'arrival' as const, delta: 1 }]
    const next = appendTick(log, newEvents, { inFlightFromStationId: null, inFlightDepartureTs: null, newTrip: null }, { maxEvents: 5 })
    expect(next.events).toHaveLength(5)
    expect(next.events[4]).toEqual(newEvents[0])
  })

  it('trims trips to maxTrips (FIFO)', () => {
    const log = {
      events: [],
      trips: Array.from({ length: 50 }, (_, i) => ({
        departure_ts: i, arrival_ts: i + 100, from_station_id: 'a', to_station_id: 'b', duration_sec: 100,
      })),
      inFlightFromStationId: null,
      inFlightDepartureTs: null,
    }
    const newTrip = { departure_ts: 999, arrival_ts: 1099, from_station_id: 'x', to_station_id: 'y', duration_sec: 100 }
    const next = appendTick(log, [], { inFlightFromStationId: null, inFlightDepartureTs: null, newTrip }, { maxTrips: 3 })
    expect(next.trips).toHaveLength(3)
    expect(next.trips[2]).toEqual(newTrip)
  })
})

describe('activityKey', () => {
  it('formats the KV key as system:<id>:activity', () => {
    expect(activityKey('bcycle_santabarbara')).toBe('system:bcycle_santabarbara:activity')
  })
})
