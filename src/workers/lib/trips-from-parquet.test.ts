import { describe, it, expect } from 'vitest'
import {
  partitionKeysForRange,
  snapshotsFromRows,
  tripsFromSnapshots,
  type Snap,
} from './trips-from-parquet'

describe('partitionKeysForRange', () => {
  it('emits one key per hour spanning the window (with 1h pad on each side)', () => {
    // 2026-05-13 12:00 UTC = 1778760000
    const since = Math.floor(Date.UTC(2026, 4, 13, 12) / 1000)
    const until = since + 2 * 3600  // 14:00 UTC
    const keys = partitionKeysForRange('bcycle_santabarbara', since, until)
    // Pad of 1h before/after means we cover 11..15 UTC inclusive (5 keys)
    expect(keys).toContain('gbfs/bcycle_santabarbara/station_status/dt=2026-05-13/11.parquet')
    expect(keys).toContain('gbfs/bcycle_santabarbara/station_status/dt=2026-05-13/12.parquet')
    expect(keys).toContain('gbfs/bcycle_santabarbara/station_status/dt=2026-05-13/13.parquet')
    expect(keys).toContain('gbfs/bcycle_santabarbara/station_status/dt=2026-05-13/14.parquet')
    expect(keys).toContain('gbfs/bcycle_santabarbara/station_status/dt=2026-05-13/15.parquet')
    expect(keys).toHaveLength(5)
  })

  it('crosses date boundaries', () => {
    // 2026-05-13 23:30 UTC for 2h
    const since = Math.floor(Date.UTC(2026, 4, 13, 23, 30) / 1000)
    const until = since + 2 * 3600
    const keys = partitionKeysForRange('bcycle_santabarbara', since, until)
    expect(keys.some(k => k.endsWith('dt=2026-05-13/23.parquet'))).toBe(true)
    expect(keys.some(k => k.endsWith('dt=2026-05-14/01.parquet'))).toBe(true)
  })
})

describe('snapshotsFromRows', () => {
  it('groups rows by snapshot_ts and sorts ascending', () => {
    const snaps = snapshotsFromRows([
      { snapshot_ts: 200, station_id: 'b', num_bikes_available: 1 },
      { snapshot_ts: 100, station_id: 'a', num_bikes_available: 3 },
      { snapshot_ts: 100, station_id: 'b', num_bikes_available: 2 },
      { snapshot_ts: 200, station_id: 'a', num_bikes_available: 3 },
    ])
    expect(snaps).toHaveLength(2)
    expect(snaps[0]!.ts).toBe(100)
    expect(snaps[1]!.ts).toBe(200)
    expect(snaps[0]!.stations).toHaveLength(2)
  })

  it('coerces bigint snapshot_ts to number', () => {
    const snaps = snapshotsFromRows([
      { snapshot_ts: BigInt(1778692030), station_id: 'a', num_bikes_available: 1 },
    ])
    expect(snaps[0]!.ts).toBe(1778692030)
    expect(typeof snaps[0]!.ts).toBe('number')
  })
})

describe('tripsFromSnapshots', () => {
  it('pairs a clean 0→1→0 active-rider transition into a trip', () => {
    // maxBikesEver=2 means active = 2 - sum(bikes).
    // Snap 100: stations a=1, b=1 → total=2, active=0
    // Snap 200: a=0, b=1 → total=1, active=1 (departure at a)
    // Snap 300: a=0, b=2 → total=2, active=0 (arrival at b) → trip a→b
    const snaps: Snap[] = [
      { ts: 100, stations: [{ station_id: 'a', num_bikes_available: 1 }, { station_id: 'b', num_bikes_available: 1 }] },
      { ts: 200, stations: [{ station_id: 'a', num_bikes_available: 0 }, { station_id: 'b', num_bikes_available: 1 }] },
      { ts: 300, stations: [{ station_id: 'a', num_bikes_available: 0 }, { station_id: 'b', num_bikes_available: 2 }] },
    ]
    const trips = tripsFromSnapshots(snaps, 2)
    expect(trips).toHaveLength(1)
    expect(trips[0]).toMatchObject({
      from_station_id: 'a',
      to_station_id: 'b',
      departure_ts: 200,
      arrival_ts: 300,
      duration_sec: 100,
    })
  })

  it('returns no trips for a single snapshot (no consecutive pair)', () => {
    const trips = tripsFromSnapshots(
      [{ ts: 100, stations: [{ station_id: 'a', num_bikes_available: 1 }] }],
      1,
    )
    expect(trips).toEqual([])
  })

  it('identifies no trips when maxBikesEver=0 (cold start)', () => {
    const snaps: Snap[] = [
      { ts: 100, stations: [{ station_id: 'a', num_bikes_available: 1 }] },
      { ts: 200, stations: [{ station_id: 'a', num_bikes_available: 0 }] },
      { ts: 300, stations: [{ station_id: 'a', num_bikes_available: 1 }] },
    ]
    const trips = tripsFromSnapshots(snaps, 0)
    expect(trips).toEqual([])
  })
})
