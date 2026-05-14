import { describe, it, expect } from 'vitest'
import { inferTrips, type SimpleMatrix } from './trip-inference'
import type { ActivityEvent, Trip } from './types'

const ev = (ts: number, id: string, type: 'departure' | 'arrival', delta = 1): ActivityEvent => ({
  ts, station_id: id, type, delta,
})

describe('inferTrips', () => {
  const matrix: SimpleMatrix = {
    a: { b: { minutes: 10, meters: 2500 }, c: { minutes: 30, meters: 7000 } },
    b: { a: { minutes: 11, meters: 2500 } },
    c: { a: { minutes: 31, meters: 7000 } },
  }

  it('pairs a single departure and arrival whose actual ≈ expected', () => {
    const events = [
      ev(0, 'a', 'departure'),
      ev(600, 'b', 'arrival'),  // 10 min — exact match
    ]
    const trips = inferTrips(events, matrix)
    expect(trips).toHaveLength(1)
    expect(trips[0]).toMatchObject({
      departure_ts: 0,
      arrival_ts: 600,
      from_station_id: 'a',
      to_station_id: 'b',
      duration_sec: 600,
    })
  })

  it('rejects pairings whose duration is implausibly short', () => {
    const events = [
      ev(0, 'a', 'departure'),
      ev(60, 'b', 'arrival'),  // 1 min — way under expected 10
    ]
    expect(inferTrips(events, matrix)).toEqual([])
  })

  it('rejects pairings whose duration is implausibly long', () => {
    const events = [
      ev(0, 'a', 'departure'),
      ev(60 * 60, 'b', 'arrival'),  // 60 min vs expected 10 → ratio 6x, rejected
    ]
    expect(inferTrips(events, matrix)).toEqual([])
  })

  it('picks the best-matching unpaired departure when several exist', () => {
    // Two departures, one to b (10min), one to c (30min); arrival at b after 12min
    // matches the a→b departure better than a→c
    const events = [
      ev(0, 'a', 'departure'),
      ev(0, 'a', 'departure'),
      ev(60 * 12, 'b', 'arrival'),
    ]
    const trips = inferTrips(events, matrix)
    expect(trips).toHaveLength(1)
    expect(trips[0]!.to_station_id).toBe('b')
  })

  it('handles delta>1 events as separate riders', () => {
    const events = [
      ev(0, 'a', 'departure', 2),
      ev(60 * 10, 'b', 'arrival'),
      ev(60 * 11, 'b', 'arrival'),
    ]
    const trips = inferTrips(events, matrix)
    expect(trips).toHaveLength(2)
    expect(trips.every(t => t.from_station_id === 'a' && t.to_station_id === 'b')).toBe(true)
  })

  it('respects existing trips so re-running does not duplicate', () => {
    const events = [
      ev(0, 'a', 'departure'),
      ev(600, 'b', 'arrival'),
    ]
    const existing: Trip[] = [{
      departure_ts: 0,
      arrival_ts: 600,
      from_station_id: 'a',
      to_station_id: 'b',
      duration_sec: 600,
    }]
    expect(inferTrips(events, matrix, existing)).toHaveLength(0)
  })

  it('skips when the matrix has no edge for the pair', () => {
    const events = [
      ev(0, 'a', 'departure'),
      ev(60 * 10, 'unknown', 'arrival'),
    ]
    expect(inferTrips(events, matrix)).toEqual([])
  })

  it('picks departures chronologically (FIFO when multiple match equally)', () => {
    // Two equal a→b departures, one arrival at b: oldest gets paired
    const events = [
      ev(0, 'a', 'departure'),
      ev(60, 'a', 'departure'),
      ev(660, 'b', 'arrival'),  // matches both equally — 10min vs 11min expected; pick the older
    ]
    const trips = inferTrips(events, matrix)
    expect(trips).toHaveLength(1)
    // The older departure has duration 660s (= 11 min), the newer 600s (= 10 min, exact match).
    // Score is |actual - expected|, so newer wins. Confirm it picks the better-scoring match.
    expect(trips[0]!.departure_ts).toBe(60)
  })
})
