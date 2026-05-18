import { describe, it, expect } from 'vitest'
import {
  buildCumulativeDistance,
  interpolatePolyline,
  tripFraction,
  classifyDuration,
  type LngLat,
} from './flow-interpolate'

describe('buildCumulativeDistance', () => {
  it('returns [] for an empty polyline', () => {
    expect(buildCumulativeDistance([])).toEqual([])
  })

  it('returns [0] for a single vertex', () => {
    expect(buildCumulativeDistance([[0, 0]])).toEqual([0])
  })

  it('computes a monotone increasing sequence with index 0 = 0', () => {
    const poly: LngLat[] = [[0, 0], [3, 4], [3, 8]]
    const cum = buildCumulativeDistance(poly)
    expect(cum[0]).toBe(0)
    expect(cum[1]).toBeCloseTo(5)
    expect(cum[2]).toBeCloseTo(9)
  })
})

describe('interpolatePolyline', () => {
  const poly: LngLat[] = [[0, 0], [10, 0], [10, 10]]
  const cum = buildCumulativeDistance(poly)

  it('returns the first vertex at t = 0', () => {
    expect(interpolatePolyline(poly, cum, 0)).toEqual([0, 0])
  })

  it('returns the last vertex at t = 1', () => {
    expect(interpolatePolyline(poly, cum, 1)).toEqual([10, 10])
  })

  it('clamps t < 0 to the first vertex', () => {
    expect(interpolatePolyline(poly, cum, -0.5)).toEqual([0, 0])
  })

  it('clamps t > 1 to the last vertex', () => {
    expect(interpolatePolyline(poly, cum, 1.5)).toEqual([10, 10])
  })

  it('lands at the midpoint of the first segment when t = 0.25 (half of the first half)', () => {
    // total distance = 20 (10 horizontal + 10 vertical). t=0.25 → 5 units in,
    // which is halfway through the first segment ((0,0)→(10,0)).
    const p = interpolatePolyline(poly, cum, 0.25)
    expect(p[0]).toBeCloseTo(5)
    expect(p[1]).toBeCloseTo(0)
  })

  it('lands at the corner vertex when t = 0.5 (end of first segment)', () => {
    const p = interpolatePolyline(poly, cum, 0.5)
    expect(p[0]).toBeCloseTo(10)
    expect(p[1]).toBeCloseTo(0)
  })

  it('lands at midpoint of second segment when t = 0.75', () => {
    const p = interpolatePolyline(poly, cum, 0.75)
    expect(p[0]).toBeCloseTo(10)
    expect(p[1]).toBeCloseTo(5)
  })

  it('handles a single-vertex polyline by returning that vertex', () => {
    expect(interpolatePolyline([[1, 2]], [0], 0.5)).toEqual([1, 2])
  })

  it('handles a zero-length polyline (degenerate)', () => {
    expect(interpolatePolyline([[5, 5], [5, 5]], [0, 0], 0.5)).toEqual([5, 5])
  })
})

describe('tripFraction', () => {
  it('returns 0 at departure', () => {
    expect(tripFraction(100, 100, 200)).toBe(0)
  })

  it('returns 1 at arrival', () => {
    expect(tripFraction(200, 100, 200)).toBe(1)
  })

  it('returns 0.5 at midpoint', () => {
    expect(tripFraction(150, 100, 200)).toBe(0.5)
  })

  it('clamps cursors before departure to 0', () => {
    expect(tripFraction(50, 100, 200)).toBe(0)
  })

  it('clamps cursors after arrival to 1', () => {
    expect(tripFraction(300, 100, 200)).toBe(1)
  })

  it('returns 0 for zero-length trips (defensive)', () => {
    expect(tripFraction(100, 100, 100)).toBe(0)
  })

  it('returns 0 for negative-duration trips (defensive)', () => {
    expect(tripFraction(100, 200, 100)).toBe(0)
  })
})

describe('classifyDuration', () => {
  it('returns unknown when no typical is available', () => {
    expect(classifyDuration(300, null)).toBe('unknown')
  })

  it('returns unknown for non-positive typical', () => {
    expect(classifyDuration(300, 0)).toBe('unknown')
  })

  it('returns fast when ratio <= 0.85', () => {
    expect(classifyDuration(85, 100)).toBe('fast')
    expect(classifyDuration(50, 100)).toBe('fast')
  })

  it('returns slow when ratio >= 1.15', () => {
    expect(classifyDuration(115, 100)).toBe('slow')
    expect(classifyDuration(200, 100)).toBe('slow')
  })

  it('returns typical in the ±15% band', () => {
    expect(classifyDuration(100, 100)).toBe('typical')
    expect(classifyDuration(90, 100)).toBe('typical')
    expect(classifyDuration(110, 100)).toBe('typical')
  })
})
