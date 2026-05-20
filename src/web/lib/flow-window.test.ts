import { describe, it, expect } from 'vitest'
import type { Trip } from '@shared/types'
import {
  computeDynamicWindow,
  pickTickInterval,
  nextDepartureAfter,
  isInGap,
  MAX_WINDOW_SEC,
  DEAD_AIR_LEAD_SEC,
} from './flow-window'

function makeTrip(departure: number, arrival: number): Trip {
  return {
    departure_ts: departure,
    arrival_ts: arrival,
    from_station_id: 'A',
    to_station_id: 'B',
    duration_sec: arrival - departure,
  }
}

const NOW = 1_700_000_000

describe('computeDynamicWindow', () => {
  it('returns the full 24h window when there are no trips', () => {
    const w = computeDynamicWindow([], NOW)
    expect(w.windowEnd).toBe(NOW)
    expect(w.windowStart).toBe(NOW - MAX_WINDOW_SEC)
  })

  it('tightens to oldestDeparture - 5min on a quiet day with recent trips', () => {
    // Two trips clustered in the last ~2h
    const oldest = NOW - 2 * 3600
    const trips = [makeTrip(oldest, oldest + 300), makeTrip(NOW - 600, NOW - 300)]
    const w = computeDynamicWindow(trips, NOW)
    expect(w.windowEnd).toBe(NOW)
    expect(w.windowStart).toBe(oldest - DEAD_AIR_LEAD_SEC)
    // Sanity: window shrunk from 24h to ~2h05m
    expect(w.windowEnd - w.windowStart).toBeLessThan(3 * 3600)
  })

  it('caps at 24h when the oldest trip is older than 24h', () => {
    // Stale trip — never let the window reach further back than 24h ago.
    const trips = [makeTrip(NOW - 30 * 3600, NOW - 30 * 3600 + 300)]
    const w = computeDynamicWindow(trips, NOW)
    expect(w.windowStart).toBe(NOW - MAX_WINDOW_SEC)
  })

  it('on a busy day uses the oldest trip across the full ~24h window', () => {
    // Trips spaced across the day, oldest 23h ago
    const oldest = NOW - 23 * 3600
    const trips = [
      makeTrip(oldest, oldest + 600),
      makeTrip(NOW - 12 * 3600, NOW - 12 * 3600 + 600),
      makeTrip(NOW - 3600, NOW - 1800),
    ]
    const w = computeDynamicWindow(trips, NOW)
    expect(w.windowStart).toBe(oldest - DEAD_AIR_LEAD_SEC)
  })
})

describe('pickTickInterval', () => {
  it('uses 15min ticks for very short spans', () => {
    expect(pickTickInterval(30 * 60)).toBe(15 * 60)
    expect(pickTickInterval(3600)).toBe(15 * 60)
  })

  it('uses 30min ticks for ~2h spans (typical quiet-day dynamic window)', () => {
    expect(pickTickInterval(2 * 3600)).toBe(30 * 60)
    expect(pickTickInterval(4 * 3600)).toBe(30 * 60)
  })

  it('uses 1h ticks for medium spans', () => {
    expect(pickTickInterval(6 * 3600)).toBe(60 * 60)
    expect(pickTickInterval(8 * 3600)).toBe(60 * 60)
  })

  it('uses 2h ticks for ~12h spans', () => {
    expect(pickTickInterval(12 * 3600)).toBe(2 * 3600)
  })

  it('uses 3h ticks for the full 24h window', () => {
    expect(pickTickInterval(24 * 3600)).toBe(3 * 3600)
  })

  it('returns a positive interval for zero/tiny spans (no divide-by-zero)', () => {
    expect(pickTickInterval(0)).toBeGreaterThan(0)
    expect(pickTickInterval(60)).toBeGreaterThan(0)
  })
})

describe('nextDepartureAfter', () => {
  const sorted = [100, 200, 300, 400]

  it('returns the first ts strictly greater than the cursor', () => {
    expect(nextDepartureAfter(sorted, 150)).toBe(200)
    expect(nextDepartureAfter(sorted, 199)).toBe(200)
    expect(nextDepartureAfter(sorted, 200)).toBe(300)
  })

  it('returns null when no later departure exists', () => {
    expect(nextDepartureAfter(sorted, 400)).toBeNull()
    expect(nextDepartureAfter(sorted, 500)).toBeNull()
  })

  it('returns null on an empty list', () => {
    expect(nextDepartureAfter([], 100)).toBeNull()
  })
})

describe('isInGap', () => {
  const trips: Trip[] = [
    makeTrip(100, 200),
    // Long gap: 200 → 1000 (800 seconds, > 5min default)
    makeTrip(1000, 1100),
  ]
  const sorted = [100, 1000]

  it('returns false when the cursor is inside an active trip', () => {
    expect(isInGap(trips, sorted, 150)).toBe(false)
    expect(isInGap(trips, sorted, 1050)).toBe(false)
  })

  it('returns true when the cursor sits in a long gap before the next trip', () => {
    // 500 → next departure 1000 = 500s away (> 300s default), no active trip
    expect(isInGap(trips, sorted, 500)).toBe(true)
  })

  it('returns false when the next departure is within the gap threshold', () => {
    // 800 → next departure 1000 = 200s away, under 300s default
    expect(isInGap(trips, sorted, 800)).toBe(false)
  })

  it('returns true before the first trip if the lead-in exceeds the gap', () => {
    // cursor at 0, first departure at 100 — 100s away, under default 300s → not a gap
    expect(isInGap(trips, sorted, 0)).toBe(false)
    // But way before: 1000s before first departure → gap
    const earlySorted = [10_000]
    expect(isInGap([makeTrip(10_000, 10_100)], earlySorted, 0)).toBe(true)
  })

  it('treats "no future departures" as a gap (caller wraps to loop start)', () => {
    expect(isInGap(trips, sorted, 2000)).toBe(true)
  })

  it('respects a custom gap threshold', () => {
    // With a 1000s threshold, the 500→1000 stretch (500s) is NOT a gap
    expect(isInGap(trips, sorted, 500, 1000)).toBe(false)
  })
})
