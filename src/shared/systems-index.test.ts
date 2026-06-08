import { describe, it, expect } from 'vitest'
import { nearestSystem, type SystemIndexEntry } from './systems-index'

const entry = (systemId: string, lon: number, lat: number): SystemIndexEntry => ({
  systemId, name: systemId, gbfsUrl: '', rentalUrl: null, timezone: 'UTC',
  centroid: [lon, lat], bbox: [lon, lat, lon, lat], stationCount: 1,
})

const SB = entry('bcycle_santabarbara', -119.7, 34.42)
const CINCY = entry('bcycle_cincyredbike', -84.51, 39.10)

describe('nearestSystem', () => {
  it('returns the closest system to a coordinate', () => {
    expect(nearestSystem([SB, CINCY], { lat: 39.1, lon: -84.5 })!.systemId).toBe('bcycle_cincyredbike')
    expect(nearestSystem([SB, CINCY], { lat: 34.4, lon: -119.7 })!.systemId).toBe('bcycle_santabarbara')
  })

  it('returns null when the list is empty', () => {
    expect(nearestSystem([], { lat: 0, lon: 0 })).toBeNull()
  })

  it('returns null when the coordinate is missing/invalid', () => {
    expect(nearestSystem([SB], null)).toBeNull()
    expect(nearestSystem([SB], { lat: NaN, lon: 0 })).toBeNull()
  })
})
