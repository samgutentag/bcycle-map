import { describe, it, expect } from 'vitest'
import { lookupRoute, type RouteCache, type RouteEdge } from './route-cache'

const EDGE_A_B: RouteEdge = { polyline: 'abc', meters: 1400, seconds: 420, via_station_ids: ['s3'] }

const CACHE: RouteCache = {
  computedAt: 1_700_000_000,
  stations: [
    { id: 's1', lat: 34.42, lon: -119.7 },
    { id: 's2', lat: 34.43, lon: -119.68 },
  ],
  edges: { s1: { s2: EDGE_A_B } },
}

describe('lookupRoute', () => {
  it('returns the edge when it exists', () => {
    expect(lookupRoute(CACHE, 's1', 's2')).toBe(EDGE_A_B)
  })

  it('returns null when the reverse edge is missing', () => {
    expect(lookupRoute(CACHE, 's2', 's1')).toBeNull()
  })

  it('returns null when either id is unknown', () => {
    expect(lookupRoute(CACHE, 's1', 'sX')).toBeNull()
    expect(lookupRoute(CACHE, 'sX', 's2')).toBeNull()
  })

  it('returns null when the cache itself is null or ids missing', () => {
    expect(lookupRoute(null, 's1', 's2')).toBeNull()
    expect(lookupRoute(CACHE, null, 's2')).toBeNull()
    expect(lookupRoute(CACHE, 's1', undefined)).toBeNull()
  })
})
