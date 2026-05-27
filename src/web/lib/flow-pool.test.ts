import { describe, it, expect } from 'vitest'
import { schedulePool } from './flow-pool'
import type { Trip } from '@shared/types'

function trip(id: number, durationSec: number, departureOffset = 0): Trip {
  return {
    departure_ts: 1000 + departureOffset,
    arrival_ts: 1000 + departureOffset + durationSec,
    from_station_id: 'A',
    to_station_id: 'B',
    duration_sec: durationSec,
  }
}

describe('schedulePool', () => {
  it('returns empty for no trips', () => {
    const s = schedulePool([])
    expect(s.entries).toHaveLength(0)
    expect(s.totalDuration).toBe(0)
  })

  it('assigns a single trip starting at 0', () => {
    const s = schedulePool([trip(0, 600)])
    expect(s.entries).toHaveLength(1)
    expect(s.entries[0]!.poolStart).toBe(0)
    expect(s.entries[0]!.poolEnd).toBeGreaterThan(0)
  })

  it('preserves departure order', () => {
    const trips = [
      trip(0, 600, 0),
      trip(1, 600, 3600),
      trip(2, 600, 7200),
    ]
    const s = schedulePool(trips)
    expect(s.entries[0]!.poolStart).toBeLessThan(s.entries[1]!.poolStart)
    expect(s.entries[1]!.poolStart).toBeLessThan(s.entries[2]!.poolStart)
  })

  it('trips departing simultaneously start at the same pool time', () => {
    const trips = [
      trip(0, 600, 0),
      trip(1, 300, 0),
      trip(2, 900, 0),
    ]
    const s = schedulePool(trips)
    expect(s.entries[0]!.poolStart).toBe(s.entries[1]!.poolStart)
    expect(s.entries[0]!.poolStart).toBe(s.entries[2]!.poolStart)
  })

  it('preserves relative density — burst cluster is tighter than trailing stragglers', () => {
    const trips = [
      trip(0, 600, 0),
      trip(1, 600, 60),
      trip(2, 600, 120),
      trip(3, 600, 7200),
      trip(4, 600, 14400),
    ]
    const s = schedulePool(trips)
    const burstGap = s.entries[2]!.poolStart - s.entries[0]!.poolStart
    const tailGap = s.entries[4]!.poolStart - s.entries[2]!.poolStart
    expect(burstGap).toBeLessThan(tailGap)
  })

  it('clamps animation duration to bounds', () => {
    const short = trip(0, 60)
    const long = trip(1, 3600)
    const s = schedulePool([short, long])
    const shortDur = s.entries[0]!.poolEnd - s.entries[0]!.poolStart
    const longDur = s.entries[1]!.poolEnd - s.entries[1]!.poolStart
    expect(shortDur).toBeGreaterThanOrEqual(4)
    expect(longDur).toBeLessThanOrEqual(12)
  })

  it('schedules all trips', () => {
    const trips = Array.from({ length: 30 }, (_, i) => trip(i, 500, i * 1000))
    const s = schedulePool(trips)
    expect(s.entries).toHaveLength(30)
  })

  it('respects target loop duration approximately', () => {
    const trips = Array.from({ length: 20 }, (_, i) => trip(i, 600, i * 1800))
    const s = schedulePool(trips, 90)
    expect(s.totalDuration).toBeGreaterThan(60)
    expect(s.totalDuration).toBeLessThan(150)
  })
})
