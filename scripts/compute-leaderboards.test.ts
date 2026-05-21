import { describe, it, expect } from 'vitest'
import {
  partitionKeyToTs,
  snapshotsFromRows,
  eventsAndTrips,
  buildLeaderboardWindow,
} from './compute-leaderboards'

describe('partitionKeyToTs', () => {
  it('parses gbfs station_status partition keys to a UTC unix-second hour', () => {
    expect(partitionKeyToTs('gbfs/bcycle_x/station_status/dt=2026-05-12/16.parquet'))
      .toBe(Math.floor(Date.UTC(2026, 4, 12, 16) / 1000))
  })
  it('returns null for non-matching keys', () => {
    expect(partitionKeyToTs('gbfs/bcycle_x/something-else.json')).toBeNull()
  })
})

describe('snapshotsFromRows', () => {
  it('groups by snapshot_ts and sorts chronologically', () => {
    const rows = [
      { snapshot_ts: 200, station_id: 'a', num_bikes_available: 5 },
      { snapshot_ts: 100, station_id: 'a', num_bikes_available: 6 },
      { snapshot_ts: 100, station_id: 'b', num_bikes_available: 3 },
    ]
    const snaps = snapshotsFromRows(rows)
    expect(snaps).toHaveLength(2)
    expect(snaps[0]!.ts).toBe(100)
    expect(snaps[0]!.stations).toHaveLength(2)
    expect(snaps[1]!.ts).toBe(200)
  })
})

describe('eventsAndTrips', () => {
  it('synthesizes events from consecutive snapshots and pairs a trip when the system passes through 1 active rider', () => {
    const maxBikesEver = 10
    const snaps = [
      { ts: 100, stations: [{ station_id: 'a', num_bikes_available: 5 }, { station_id: 'b', num_bikes_available: 5 }] },
      { ts: 200, stations: [{ station_id: 'a', num_bikes_available: 4 }, { station_id: 'b', num_bikes_available: 5 }] }, // dep a
      { ts: 400, stations: [{ station_id: 'a', num_bikes_available: 4 }, { station_id: 'b', num_bikes_available: 6 }] }, // arr b
    ]
    const { events, trips } = eventsAndTrips(snaps, maxBikesEver)
    expect(events).toHaveLength(2)
    expect(trips).toHaveLength(1)
    expect(trips[0]!.from_station_id).toBe('a')
    expect(trips[0]!.to_station_id).toBe('b')
  })
})

describe('buildLeaderboardWindow — stations', () => {
  it('ranks by total (departures + arrivals) and includes the per-direction split', () => {
    const now = 1_700_000_000
    const events = [
      { ts: now - 10, station_id: 'a', type: 'departure' as const, delta: 3 },
      { ts: now - 9, station_id: 'a', type: 'arrival' as const, delta: 2 },
      { ts: now - 8, station_id: 'b', type: 'departure' as const, delta: 1 },
      { ts: now - 7, station_id: 'c', type: 'arrival' as const, delta: 5 },
    ]
    const win = buildLeaderboardWindow(events, [], 0)
    expect(win.stations).toEqual([
      { station_id: 'a', departures: 3, arrivals: 2, total: 5 },
      { station_id: 'c', departures: 0, arrivals: 5, total: 5 },
      { station_id: 'b', departures: 1, arrivals: 0, total: 1 },
    ])
  })

  it('honors the sinceTs cutoff — events before the cutoff are dropped', () => {
    const now = 1_700_000_000
    const cutoff = now - 100
    const events = [
      { ts: now - 200, station_id: 'a', type: 'departure' as const, delta: 9 },  // dropped (before cutoff)
      { ts: now - 50, station_id: 'a', type: 'departure' as const, delta: 1 },    // kept
      { ts: now - 50, station_id: 'b', type: 'arrival' as const, delta: 4 },      // kept
    ]
    const win = buildLeaderboardWindow(events, [], cutoff)
    expect(win.stations.find(s => s.station_id === 'a')!.departures).toBe(1)
    expect(win.stations.find(s => s.station_id === 'b')!.arrivals).toBe(4)
  })

  it('caps the station list at the top 20 even when more stations have activity', () => {
    const events = Array.from({ length: 25 }, (_, i) => ({
      ts: 100 + i,
      station_id: `s${i}`,
      type: 'departure' as const,
      delta: 25 - i, // s0 highest, s24 lowest
    }))
    const win = buildLeaderboardWindow(events, [], 0)
    expect(win.stations).toHaveLength(20)
    expect(win.stations[0]!.station_id).toBe('s0')
    expect(win.stations[19]!.station_id).toBe('s19')
  })
})

describe('buildLeaderboardWindow — routes', () => {
  function mkTrip(from: string, to: string, departure_ts: number) {
    return {
      from_station_id: from,
      to_station_id: to,
      departure_ts,
      arrival_ts: departure_ts + 600,
      duration_sec: 600,
    }
  }

  it('counts directed pairs and ranks by trip count', () => {
    const trips = [
      ...Array.from({ length: 7 }, (_, i) => mkTrip('a', 'b', 100 + i)),
      ...Array.from({ length: 5 }, (_, i) => mkTrip('b', 'a', 200 + i)),
    ]
    const win = buildLeaderboardWindow([], trips, 0)
    expect(win.routes).toEqual([
      { from: 'a', to: 'b', trips: 7 },
      { from: 'b', to: 'a', trips: 5 },
    ])
  })

  it('filters routes with fewer than 5 trips (ROUTE_MIN_TRIPS)', () => {
    const trips = [
      ...Array.from({ length: 5 }, (_, i) => mkTrip('a', 'b', 100 + i)), // kept (=5)
      ...Array.from({ length: 4 }, (_, i) => mkTrip('c', 'd', 200 + i)), // dropped (<5)
      ...Array.from({ length: 1 }, (_, i) => mkTrip('x', 'y', 300 + i)), // dropped (<5)
    ]
    const win = buildLeaderboardWindow([], trips, 0)
    expect(win.routes).toEqual([{ from: 'a', to: 'b', trips: 5 }])
  })

  it('honors the sinceTs cutoff for trips too — only counts trips departing in window', () => {
    const cutoff = 500
    const trips = [
      ...Array.from({ length: 6 }, (_, i) => mkTrip('a', 'b', 100 + i)), // before cutoff
      ...Array.from({ length: 5 }, (_, i) => mkTrip('c', 'd', 600 + i)), // in window
    ]
    const win = buildLeaderboardWindow([], trips, cutoff)
    expect(win.routes).toEqual([{ from: 'c', to: 'd', trips: 5 }])
  })

  it('all-time window (sinceTs=0) returns everything that clears the threshold', () => {
    const trips = [
      ...Array.from({ length: 5 }, (_, i) => mkTrip('a', 'b', 0 + i)),
      ...Array.from({ length: 5 }, (_, i) => mkTrip('c', 'd', 5_000_000_000 + i)),
    ]
    const win = buildLeaderboardWindow([], trips, 0)
    expect(win.routes).toHaveLength(2)
  })

  it('caps routes at top 20', () => {
    const trips: ReturnType<typeof mkTrip>[] = []
    for (let i = 0; i < 25; i++) {
      const count = 25 - i // route i has (25-i) trips
      for (let j = 0; j < count; j++) {
        trips.push(mkTrip(`from${i}`, `to${i}`, 100 + i * 100 + j))
      }
    }
    const win = buildLeaderboardWindow([], trips, 0)
    expect(win.routes).toHaveLength(20)
    expect(win.routes[0]!.trips).toBe(25)
    // First 20 routes have counts 25..6, all above the 5-trip threshold.
    expect(win.routes[19]!.trips).toBe(6)
  })
})
