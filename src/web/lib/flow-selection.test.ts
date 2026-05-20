import { describe, it, expect } from 'vitest'
import type { Trip } from '@shared/types'
import { selectVisibleTrips, capTripsForRender } from './flow-selection'

function makeTrip(departure: number, arrival: number, dur?: number): Trip {
  return {
    departure_ts: departure,
    arrival_ts: arrival,
    from_station_id: 'A',
    to_station_id: 'B',
    duration_sec: dur ?? arrival - departure,
  }
}

describe('selectVisibleTrips', () => {
  const trips: Trip[] = [
    makeTrip(100, 200),
    makeTrip(150, 250),
    makeTrip(300, 400),
  ]

  it('returns trips whose window covers the cursor', () => {
    expect(selectVisibleTrips(trips, 175)).toHaveLength(2)
    expect(selectVisibleTrips(trips, 350)).toHaveLength(1)
  })

  it('includes trips exactly at their departure or arrival edge', () => {
    expect(selectVisibleTrips(trips, 100)).toHaveLength(1)
    expect(selectVisibleTrips(trips, 200)).toHaveLength(2)
    expect(selectVisibleTrips(trips, 400)).toHaveLength(1)
  })

  it('returns an empty list when the cursor falls in a gap', () => {
    expect(selectVisibleTrips(trips, 275)).toHaveLength(0)
    expect(selectVisibleTrips(trips, 50)).toHaveLength(0)
    expect(selectVisibleTrips(trips, 1000)).toHaveLength(0)
  })

  it('handles an empty trip list', () => {
    expect(selectVisibleTrips([], 100)).toEqual([])
  })
})

describe('capTripsForRender', () => {
  it('passes through unchanged when under cap', () => {
    const trips = [makeTrip(0, 60, 60), makeTrip(0, 120, 120)]
    const { rendered, totalCount } = capTripsForRender(trips, 80)
    expect(rendered).toHaveLength(2)
    expect(totalCount).toBe(2)
  })

  it('trims to the cap when over, keeping longest-duration trips', () => {
    const trips = [
      makeTrip(0, 60, 60),
      makeTrip(0, 600, 600),
      makeTrip(0, 30, 30),
      makeTrip(0, 300, 300),
    ]
    const { rendered, totalCount } = capTripsForRender(trips, 2)
    expect(rendered).toHaveLength(2)
    expect(totalCount).toBe(4)
    expect(rendered[0]!.duration_sec).toBe(600)
    expect(rendered[1]!.duration_sec).toBe(300)
  })

  it('handles empty input', () => {
    const { rendered, totalCount } = capTripsForRender([], 80)
    expect(rendered).toEqual([])
    expect(totalCount).toBe(0)
  })
})
