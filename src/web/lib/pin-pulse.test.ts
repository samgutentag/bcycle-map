import { describe, it, expect } from 'vitest'
import { diffSnapshots } from './pin-pulse'
import type { StationSnapshot } from '@shared/types'

function station(id: string, bikes: number, docks: number): StationSnapshot {
  return {
    station_id: id,
    name: id,
    lat: 0,
    lon: 0,
    num_bikes_available: bikes,
    num_docks_available: docks,
    bikes_electric: bikes,
    bikes_classic: 0,
    bikes_smart: 0,
    is_installed: true,
    is_renting: true,
    is_returning: true,
    last_reported: 0,
  }
}

describe('diffSnapshots', () => {
  it('returns no events when bikes and docks are unchanged', () => {
    const prev = [station('a', 3, 7)]
    const next = [station('a', 3, 7)]
    expect(diffSnapshots(prev, next)).toEqual([])
  })

  it("emits 'in' when bikes increased (and docks mirror)", () => {
    const prev = [station('a', 3, 7)]
    const next = [station('a', 5, 5)]
    expect(diffSnapshots(prev, next)).toEqual([{ stationId: 'a', direction: 'in' }])
  })

  it("emits 'out' when bikes decreased (and docks mirror)", () => {
    const prev = [station('a', 5, 5)]
    const next = [station('a', 3, 7)]
    expect(diffSnapshots(prev, next)).toEqual([{ stationId: 'a', direction: 'out' }])
  })

  it("emits 'in' when bikes increased with no dock change (capacity grew)", () => {
    const prev = [station('a', 3, 7)]
    const next = [station('a', 4, 7)]
    expect(diffSnapshots(prev, next)).toEqual([{ stationId: 'a', direction: 'in' }])
  })

  it("emits 'neutral' when bikes and docks both moved non-mirrored", () => {
    // Bikes +1 and docks +2 — couldn't be a simple ride event.
    const prev = [station('a', 3, 5)]
    const next = [station('a', 4, 7)]
    expect(diffSnapshots(prev, next)).toEqual([{ stationId: 'a', direction: 'neutral' }])
  })

  it("emits 'neutral' when only docks change (capacity-only shift)", () => {
    const prev = [station('a', 3, 5)]
    const next = [station('a', 3, 6)]
    expect(diffSnapshots(prev, next)).toEqual([{ stationId: 'a', direction: 'neutral' }])
  })

  it('skips stations missing from the previous snapshot (no baseline)', () => {
    const prev = [station('a', 3, 5)]
    const next = [station('a', 3, 5), station('b', 1, 9)]
    expect(diffSnapshots(prev, next)).toEqual([])
  })

  it('skips stations missing from the next snapshot', () => {
    const prev = [station('a', 3, 5), station('b', 1, 9)]
    const next = [station('a', 4, 4)]
    expect(diffSnapshots(prev, next)).toEqual([{ stationId: 'a', direction: 'in' }])
  })

  it('returns an empty list when either snapshot is null or empty', () => {
    expect(diffSnapshots(null, [station('a', 1, 1)])).toEqual([])
    expect(diffSnapshots([station('a', 1, 1)], null)).toEqual([])
    expect(diffSnapshots([], [station('a', 1, 1)])).toEqual([])
    expect(diffSnapshots([station('a', 1, 1)], [])).toEqual([])
  })

  it('handles multiple stations independently in one pass', () => {
    const prev = [station('a', 3, 5), station('b', 2, 8), station('c', 4, 4)]
    const next = [station('a', 4, 4), station('b', 2, 8), station('c', 2, 6)]
    const events = diffSnapshots(prev, next)
    expect(events).toHaveLength(2)
    expect(events).toContainEqual({ stationId: 'a', direction: 'in' })
    expect(events).toContainEqual({ stationId: 'c', direction: 'out' })
  })
})
