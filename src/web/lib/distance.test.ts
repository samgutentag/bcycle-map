import { describe, expect, it } from 'vitest'
import { formatWalkingDistance, HALF_MILE_M, haversineMeters, ONE_MILE_M } from './distance'

describe('haversineMeters', () => {
  it('returns 0 for identical points', () => {
    const p = { lat: 34.4208, lon: -119.6982 }
    expect(haversineMeters(p, p)).toBe(0)
  })

  it('is symmetric', () => {
    const a = { lat: 34.4208, lon: -119.6982 }
    const b = { lat: 34.425, lon: -119.69 }
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6)
  })

  it('matches a known ~1 km hop in Santa Barbara (within 1%)', () => {
    // Two arbitrary points roughly 1 km apart in downtown SB.
    const a = { lat: 34.4208, lon: -119.6982 }
    const b = { lat: 34.4298, lon: -119.6982 }  // ~1 km north
    const m = haversineMeters(a, b)
    expect(m).toBeGreaterThan(990)
    expect(m).toBeLessThan(1010)
  })

  it('handles antipodal-ish hops without NaN', () => {
    const a = { lat: 0, lon: 0 }
    const b = { lat: 0, lon: 179.9 }
    const m = haversineMeters(a, b)
    expect(Number.isFinite(m)).toBe(true)
    expect(m).toBeGreaterThan(19_000_000)
  })

  it('half-mile constant matches the 0.5-mi distance helper', () => {
    // 0.5 mi is the default search radius on the nearby-stations sheet.
    expect(HALF_MILE_M).toBeCloseTo(804.672, 2)
    expect(ONE_MILE_M).toBeCloseTo(1609.344, 2)
  })
})

describe('formatWalkingDistance', () => {
  it('renders feet under ~1000 ft, rounded to nearest 10', () => {
    expect(formatWalkingDistance(0)).toBe('0 ft')
    expect(formatWalkingDistance(30)).toBe('100 ft')   // 30 m ≈ 98 ft → 100
    expect(formatWalkingDistance(100)).toBe('330 ft')  // 100 m ≈ 328 ft → 330
    expect(formatWalkingDistance(300)).toBe('980 ft')  // 300 m ≈ 984 ft → 980
  })

  it('renders miles above the ~1000 ft crossover with one decimal', () => {
    expect(formatWalkingDistance(500)).toBe('0.3 mi')   // 500 m ≈ 0.31 mi
    expect(formatWalkingDistance(800)).toBe('0.5 mi')
    expect(formatWalkingDistance(1609)).toBe('1.0 mi')
    expect(formatWalkingDistance(3200)).toBe('2.0 mi')
  })

  it('renders very short mile-range distances with two decimals (no 0.0 mi)', () => {
    // 320 m ≈ 0.198 mi — sits just above the feet/miles crossover.
    expect(formatWalkingDistance(320)).toMatch(/^0\.\d{1,2} mi$/)
  })

  it('returns an empty string for negative or non-finite inputs', () => {
    expect(formatWalkingDistance(-1)).toBe('')
    expect(formatWalkingDistance(Number.NaN)).toBe('')
    expect(formatWalkingDistance(Number.POSITIVE_INFINITY)).toBe('')
  })
})
