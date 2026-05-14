import { describe, it, expect } from 'vitest'
import { partitionKeysFor24h, statsFromRows, mergeRecent24h } from './backfill-recent24h'

describe('partitionKeysFor24h', () => {
  it('returns 23 partitions ending one hour before the current hour', () => {
    // now = 2026-05-14 10:35 UTC → currentHour = 10:00 UTC
    const nowSec = Math.floor(Date.UTC(2026, 4, 14, 10, 35, 0) / 1000)
    const parts = partitionKeysFor24h('bcycle_x', nowSec)
    expect(parts).toHaveLength(23)
    // First partition (oldest): 23 hours before currentHour
    expect(parts[0]!.hourTs).toBe(Math.floor(Date.UTC(2026, 4, 13, 11, 0, 0) / 1000))
    // Last partition: 1 hour before currentHour
    expect(parts[22]!.hourTs).toBe(Math.floor(Date.UTC(2026, 4, 14, 9, 0, 0) / 1000))
  })

  it('formats partition keys with zero-padded UTC date and hour', () => {
    const nowSec = Math.floor(Date.UTC(2026, 0, 2, 3, 15, 0) / 1000)  // 2026-01-02 03:15 UTC
    const parts = partitionKeysFor24h('bcycle_x', nowSec)
    // Last entry is 1 hour before 03:00 = 02:00 UTC
    expect(parts[22]!.key).toBe('gbfs/bcycle_x/station_status/dt=2026-01-02/02.parquet')
  })

  it('crosses date boundaries cleanly', () => {
    // now = 2026-05-14 02:30 UTC. 23 hours back = 2026-05-13 03:00
    const nowSec = Math.floor(Date.UTC(2026, 4, 14, 2, 30, 0) / 1000)
    const parts = partitionKeysFor24h('bcycle_x', nowSec)
    expect(parts[0]!.key).toBe('gbfs/bcycle_x/station_status/dt=2026-05-13/03.parquet')
    expect(parts[22]!.key).toBe('gbfs/bcycle_x/station_status/dt=2026-05-14/01.parquet')
  })
})

describe('statsFromRows', () => {
  it('groups by snapshot_ts and returns min/max of system-wide bikes available', () => {
    const rows = [
      // snapshot 100: total bikes = 50
      { snapshot_ts: 100, station_id: 'a', num_bikes_available: 30, num_docks_available: 0 },
      { snapshot_ts: 100, station_id: 'b', num_bikes_available: 20, num_docks_available: 0 },
      // snapshot 200: total bikes = 60
      { snapshot_ts: 200, station_id: 'a', num_bikes_available: 40, num_docks_available: 0 },
      { snapshot_ts: 200, station_id: 'b', num_bikes_available: 20, num_docks_available: 0 },
      // snapshot 300: total bikes = 45
      { snapshot_ts: 300, station_id: 'a', num_bikes_available: 25, num_docks_available: 0 },
      { snapshot_ts: 300, station_id: 'b', num_bikes_available: 20, num_docks_available: 0 },
    ]
    expect(statsFromRows(rows)).toEqual({ bikes_min: 45, bikes_max: 60 })
  })

  it('handles bigint snapshot_ts (parquet sometimes returns these)', () => {
    const rows = [
      { snapshot_ts: 100n as bigint, station_id: 'a', num_bikes_available: 10, num_docks_available: 0 },
      { snapshot_ts: 200n as bigint, station_id: 'a', num_bikes_available: 15, num_docks_available: 0 },
    ]
    expect(statsFromRows(rows)).toEqual({ bikes_min: 10, bikes_max: 15 })
  })

  it('returns null for empty input', () => {
    expect(statsFromRows([])).toBeNull()
  })
})

describe('mergeRecent24h', () => {
  const now = 1_700_000_000  // some unix ts in seconds
  const HOUR = 3600

  it('unions existing and new entries by hour_ts', () => {
    const existing = [{ hour_ts: now - HOUR, bikes_min: 100, bikes_max: 110 }]
    const entries = [{ hour_ts: now - 2 * HOUR, bikes_min: 90, bikes_max: 95 }]
    const merged = mergeRecent24h(existing, entries, now)
    expect(merged).toHaveLength(2)
    expect(merged[0]!.hour_ts).toBe(now - 2 * HOUR)
    expect(merged[1]!.hour_ts).toBe(now - HOUR)
  })

  it('lets existing entries win on hour_ts overlap (poller-set current hour is preserved)', () => {
    const existing = [{ hour_ts: now - HOUR, bikes_min: 100, bikes_max: 110 }]
    const entries = [{ hour_ts: now - HOUR, bikes_min: 200, bikes_max: 300 }]
    const merged = mergeRecent24h(existing, entries, now)
    expect(merged).toHaveLength(1)
    expect(merged[0]!.bikes_min).toBe(100)  // existing wins
    expect(merged[0]!.bikes_max).toBe(110)
  })

  it('filters entries older than 24 hours', () => {
    const existing = [
      { hour_ts: now - 25 * HOUR, bikes_min: 1, bikes_max: 2 },  // dropped
      { hour_ts: now - 2 * HOUR, bikes_min: 5, bikes_max: 6 },
    ]
    const merged = mergeRecent24h(existing, [], now)
    expect(merged).toHaveLength(1)
    expect(merged[0]!.hour_ts).toBe(now - 2 * HOUR)
  })

  it('sorts the result by hour_ts ascending', () => {
    const entries = [
      { hour_ts: now - 3 * HOUR, bikes_min: 1, bikes_max: 1 },
      { hour_ts: now - HOUR, bikes_min: 2, bikes_max: 2 },
      { hour_ts: now - 5 * HOUR, bikes_min: 3, bikes_max: 3 },
    ]
    const merged = mergeRecent24h([], entries, now)
    expect(merged.map(e => e.hour_ts)).toEqual([now - 5 * HOUR, now - 3 * HOUR, now - HOUR])
  })
})
