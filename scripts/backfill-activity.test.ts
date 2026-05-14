import { describe, it, expect } from 'vitest'
import {
  partitionKeysForHoursBack,
  snapshotsFromRows,
  replaySnapshots,
  mergeLogs,
} from './backfill-activity'
import { emptyActivityLog } from '../src/shared/activity'

describe('partitionKeysForHoursBack', () => {
  it('returns N partitions for hours preceding the current UTC hour', () => {
    const nowSec = Math.floor(Date.UTC(2026, 4, 14, 10, 35, 0) / 1000)
    const parts = partitionKeysForHoursBack('bcycle_x', nowSec, 3)
    expect(parts).toHaveLength(3)
    expect(parts[0]!.hourTs).toBe(Math.floor(Date.UTC(2026, 4, 14, 7, 0, 0) / 1000))
    expect(parts[2]!.hourTs).toBe(Math.floor(Date.UTC(2026, 4, 14, 9, 0, 0) / 1000))
  })

  it('zero-pads partition keys for UTC date and hour', () => {
    const nowSec = Math.floor(Date.UTC(2026, 0, 2, 3, 15, 0) / 1000)
    const parts = partitionKeysForHoursBack('bcycle_x', nowSec, 2)
    expect(parts[1]!.key).toBe('gbfs/bcycle_x/station_status/dt=2026-01-02/02.parquet')
  })
})

describe('snapshotsFromRows', () => {
  it('groups rows by snapshot_ts and sorts chronologically', () => {
    const rows = [
      { snapshot_ts: 200, station_id: 'a', num_bikes_available: 5 },
      { snapshot_ts: 100, station_id: 'a', num_bikes_available: 6 },
      { snapshot_ts: 100, station_id: 'b', num_bikes_available: 3 },
      { snapshot_ts: 200, station_id: 'b', num_bikes_available: 4 },
    ]
    const snaps = snapshotsFromRows(rows)
    expect(snaps).toHaveLength(2)
    expect(snaps[0]!.ts).toBe(100)
    expect(snaps[0]!.stations).toHaveLength(2)
    expect(snaps[1]!.ts).toBe(200)
  })

  it('converts bigint snapshot_ts to number', () => {
    const rows = [
      { snapshot_ts: 100n as bigint, station_id: 'a', num_bikes_available: 5 },
    ]
    const snaps = snapshotsFromRows(rows)
    expect(snaps[0]!.ts).toBe(100)
  })
})

describe('replaySnapshots', () => {
  it('emits per-tick events across consecutive snapshots', () => {
    const snaps = [
      { ts: 100, stations: [{ station_id: 'a', num_bikes_available: 5 }, { station_id: 'b', num_bikes_available: 3 }] },
      { ts: 200, stations: [{ station_id: 'a', num_bikes_available: 4 }, { station_id: 'b', num_bikes_available: 3 }] },  // a -1: departure
      { ts: 300, stations: [{ station_id: 'a', num_bikes_available: 4 }, { station_id: 'b', num_bikes_available: 4 }] },  // b +1: arrival
    ]
    const log = replaySnapshots(snaps, 100)
    expect(log.events).toHaveLength(2)
    expect(log.events[0]).toMatchObject({ ts: 200, station_id: 'a', type: 'departure', delta: 1 })
    expect(log.events[1]).toMatchObject({ ts: 300, station_id: 'b', type: 'arrival', delta: 1 })
  })

  it('pairs trips when the system transitions cleanly through 1 active rider', () => {
    const maxBikesEver = 10
    const snaps = [
      // total = 10 → 0 active
      { ts: 100, stations: [{ station_id: 'a', num_bikes_available: 5 }, { station_id: 'b', num_bikes_available: 5 }] },
      // total = 9 → 1 active (departure from a)
      { ts: 200, stations: [{ station_id: 'a', num_bikes_available: 4 }, { station_id: 'b', num_bikes_available: 5 }] },
      // total = 9, no change
      { ts: 300, stations: [{ station_id: 'a', num_bikes_available: 4 }, { station_id: 'b', num_bikes_available: 5 }] },
      // total = 10 → 0 active (arrival at b)
      { ts: 400, stations: [{ station_id: 'a', num_bikes_available: 4 }, { station_id: 'b', num_bikes_available: 6 }] },
    ]
    const log = replaySnapshots(snaps, maxBikesEver)
    expect(log.trips).toHaveLength(1)
    expect(log.trips[0]).toMatchObject({
      departure_ts: 200,
      arrival_ts: 400,
      from_station_id: 'a',
      to_station_id: 'b',
      duration_sec: 200,
    })
  })

  it('skips trip pairing across multi-rider activity', () => {
    const snaps = [
      // total = 10 (0 active)
      { ts: 100, stations: [{ station_id: 'a', num_bikes_available: 5 }, { station_id: 'b', num_bikes_available: 5 }] },
      // total = 9 (1 active, departure from a)
      { ts: 200, stations: [{ station_id: 'a', num_bikes_available: 4 }, { station_id: 'b', num_bikes_available: 5 }] },
      // total = 8 (2 active, departure from b) — multi-rider, cancels pairing
      { ts: 300, stations: [{ station_id: 'a', num_bikes_available: 4 }, { station_id: 'b', num_bikes_available: 4 }] },
      // total = 10 (0 active, two arrivals in one tick)
      { ts: 400, stations: [{ station_id: 'a', num_bikes_available: 5 }, { station_id: 'b', num_bikes_available: 5 }] },
    ]
    const log = replaySnapshots(snaps, 10)
    expect(log.trips).toHaveLength(0)
  })
})

describe('mergeLogs', () => {
  const ev = (ts: number, id: string, type: 'departure' | 'arrival') => ({
    ts, station_id: id, type, delta: 1,
  })
  const tr = (depTs: number, arrTs: number, from: string, to: string) => ({
    departure_ts: depTs, arrival_ts: arrTs, from_station_id: from, to_station_id: to, duration_sec: arrTs - depTs,
  })

  it('appends backfilled events that are not already present', () => {
    const existing = { ...emptyActivityLog(), events: [ev(200, 'a', 'arrival')] }
    const backfill = { ...emptyActivityLog(), events: [ev(100, 'a', 'departure')] }
    const merged = mergeLogs(existing, backfill, { maxEvents: 200, maxTrips: 50 })
    expect(merged.events).toHaveLength(2)
    expect(merged.events[0]!.ts).toBe(100)
    expect(merged.events[1]!.ts).toBe(200)
  })

  it('dedupes events with the same (ts, station_id, type)', () => {
    const existing = { ...emptyActivityLog(), events: [ev(100, 'a', 'departure')] }
    const backfill = { ...emptyActivityLog(), events: [ev(100, 'a', 'departure'), ev(200, 'a', 'arrival')] }
    const merged = mergeLogs(existing, backfill, { maxEvents: 200, maxTrips: 50 })
    expect(merged.events).toHaveLength(2)
    expect(merged.events.filter(e => e.ts === 100)).toHaveLength(1)
  })

  it('dedupes trips with the same (departure_ts, arrival_ts, from, to)', () => {
    const existing = { ...emptyActivityLog(), trips: [tr(100, 200, 'a', 'b')] }
    const backfill = { ...emptyActivityLog(), trips: [tr(100, 200, 'a', 'b'), tr(300, 400, 'c', 'd')] }
    const merged = mergeLogs(existing, backfill, { maxEvents: 200, maxTrips: 50 })
    expect(merged.trips).toHaveLength(2)
  })

  it('preserves the live in-flight markers from existing', () => {
    const existing = { ...emptyActivityLog(), inFlightFromStationId: 'a', inFlightDepartureTs: 999 }
    const backfill = { ...emptyActivityLog(), inFlightFromStationId: 'b', inFlightDepartureTs: 1 }
    const merged = mergeLogs(existing, backfill, { maxEvents: 200, maxTrips: 50 })
    expect(merged.inFlightFromStationId).toBe('a')
    expect(merged.inFlightDepartureTs).toBe(999)
  })

  it('trims to caps when merge exceeds limits', () => {
    const existing = {
      ...emptyActivityLog(),
      events: Array.from({ length: 100 }, (_, i) => ev(i, `s${i}`, 'departure')),
    }
    const backfill = {
      ...emptyActivityLog(),
      events: Array.from({ length: 50 }, (_, i) => ev(100 + i, `s${100 + i}`, 'departure')),
    }
    const merged = mergeLogs(existing, backfill, { maxEvents: 30, maxTrips: 50 })
    expect(merged.events).toHaveLength(30)
    // Most recent retained: last 30 should be the highest ts values
    expect(merged.events[0]!.ts).toBe(120)
    expect(merged.events[29]!.ts).toBe(149)
  })
})
