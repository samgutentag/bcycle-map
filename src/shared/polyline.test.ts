import { describe, it, expect } from 'vitest'
import { decodePolyline } from './polyline'

describe('decodePolyline', () => {
  it('decodes the canonical Google fixture into [lng, lat] pairs', () => {
    // From https://developers.google.com/maps/documentation/utilities/polylinealgorithm
    const points = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')
    expect(points).toHaveLength(3)
    expect(points[0]![0]).toBeCloseTo(-120.2, 5)
    expect(points[0]![1]).toBeCloseTo(38.5, 5)
    expect(points[1]![0]).toBeCloseTo(-120.95, 5)
    expect(points[1]![1]).toBeCloseTo(40.7, 5)
    expect(points[2]![0]).toBeCloseTo(-126.453, 5)
    expect(points[2]![1]).toBeCloseTo(43.252, 5)
  })

  it('returns an empty array for an empty input', () => {
    expect(decodePolyline('')).toEqual([])
  })

  it('decodes a single coordinate', () => {
    // Encoded form of (0, 0) is "??"
    expect(decodePolyline('??')).toEqual([[0, 0]])
  })
})
