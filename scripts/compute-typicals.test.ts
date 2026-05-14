import { describe, it, expect } from 'vitest'
import { aggregateTypicals, localPartsForTs } from './compute-typicals'

describe('localPartsForTs', () => {
  it('returns Tuesday for a Tuesday-at-9am Pacific timestamp', () => {
    // 2026-05-12 Tuesday at 9am Pacific = 16:00 UTC = 1778688000
    const ts = Math.floor(Date.UTC(2026, 4, 12, 16) / 1000)
    const parts = localPartsForTs(ts, 'America/Los_Angeles')
    expect(parts.dow).toBe(2) // Sun=0, Mon=1, Tue=2
    expect(parts.hour).toBe(9)
  })
})

describe('aggregateTypicals', () => {
  it('returns an empty map for empty input', () => {
    const result = aggregateTypicals([], 'UTC')
    expect(result.size).toBe(0)
  })

  it('computes per-station hour-of-day averages', () => {
    // Two stations, each with two samples at hour 0 UTC
    const ts1 = Math.floor(Date.UTC(2026, 4, 13, 0, 0) / 1000)
    const ts2 = ts1 + 60
    const samples = [
      { station_id: 'a', snapshot_ts: ts1, num_bikes_available: 4, num_docks_available: 6 },
      { station_id: 'a', snapshot_ts: ts2, num_bikes_available: 6, num_docks_available: 4 },
      { station_id: 'b', snapshot_ts: ts1, num_bikes_available: 10, num_docks_available: 0 },
    ]
    const result = aggregateTypicals(samples, 'UTC')
    const a = result.get('a')!
    expect(a.allDays[0]!.bikes).toBe(5)   // (4 + 6) / 2
    expect(a.allDays[0]!.docks).toBe(5)
    expect(a.allDays[0]!.samples).toBe(2)
    const b = result.get('b')!
    expect(b.allDays[0]!.bikes).toBe(10)
    expect(b.allDays[0]!.samples).toBe(1)
  })

  it('separates samples by day-of-week', () => {
    // 2026-05-12 Tuesday 12:00 UTC = hour 12, dow 2
    const tuesNoon = Math.floor(Date.UTC(2026, 4, 12, 12) / 1000)
    // 2026-05-13 Wednesday 12:00 UTC = hour 12, dow 3
    const wedNoon = Math.floor(Date.UTC(2026, 4, 13, 12) / 1000)
    const samples = [
      { station_id: 's1', snapshot_ts: tuesNoon, num_bikes_available: 2, num_docks_available: 8 },
      { station_id: 's1', snapshot_ts: wedNoon, num_bikes_available: 8, num_docks_available: 2 },
    ]
    const result = aggregateTypicals(samples, 'UTC')
    const s1 = result.get('s1')!
    expect(s1.byDow[2]![12]!.bikes).toBe(2)  // Tuesday noon
    expect(s1.byDow[3]![12]!.bikes).toBe(8)  // Wednesday noon
    expect(s1.allDays[12]!.bikes).toBe(5)    // average of Tue + Wed at noon
  })

  it('counts distinct dates per station for daysCovered', () => {
    const ts1 = Math.floor(Date.UTC(2026, 4, 12, 12) / 1000)
    const ts2 = Math.floor(Date.UTC(2026, 4, 13, 12) / 1000)
    const ts3 = Math.floor(Date.UTC(2026, 4, 13, 13) / 1000)  // same day as ts2
    const samples = [
      { station_id: 's', snapshot_ts: ts1, num_bikes_available: 1, num_docks_available: 1 },
      { station_id: 's', snapshot_ts: ts2, num_bikes_available: 1, num_docks_available: 1 },
      { station_id: 's', snapshot_ts: ts3, num_bikes_available: 1, num_docks_available: 1 },
    ]
    const result = aggregateTypicals(samples, 'UTC')
    expect(result.get('s')!.daysCovered).toBe(2)
  })
})
