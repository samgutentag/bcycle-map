import { describe, it, expect } from 'vitest'
import { DEFAULT_UNIT_SYSTEM, formatDistance, formatSpeed } from './units'

describe('units', () => {
  describe('DEFAULT_UNIT_SYSTEM', () => {
    it('defaults to imperial', () => {
      expect(DEFAULT_UNIT_SYSTEM).toBe('imperial')
    })
  })

  describe('formatDistance — imperial', () => {
    it('renders zero as 0 ft', () => {
      expect(formatDistance(0, 'imperial')).toBe('0 ft')
    })

    it('renders very short distances in feet rounded to nearest 10', () => {
      // 50 m ≈ 164 ft → rounded to 160
      expect(formatDistance(50, 'imperial')).toBe('160 ft')
    })

    it('renders just below the 0.1 mi threshold in feet', () => {
      // 160 m ≈ 524.9 ft → rounded to 520
      expect(formatDistance(160, 'imperial')).toBe('520 ft')
    })

    it('renders at the 0.1 mi threshold in miles', () => {
      // 0.1 mi = 160.9344 m → 0.1 mi
      expect(formatDistance(161, 'imperial')).toBe('0.1 mi')
    })

    it('renders multi-mile distances in miles to one decimal', () => {
      // 3219 m / 1609.344 ≈ 2.0 mi
      expect(formatDistance(3219, 'imperial')).toBe('2.0 mi')
    })

    it('renders long distances in miles to one decimal (no whole-number switch)', () => {
      // 20000 m ≈ 12.43 mi → 12.4 mi
      expect(formatDistance(20000, 'imperial')).toBe('12.4 mi')
    })

    it('collapses negative meters to 0 ft', () => {
      expect(formatDistance(-50, 'imperial')).toBe('0 ft')
    })

    it('collapses NaN meters to 0 ft', () => {
      expect(formatDistance(NaN, 'imperial')).toBe('0 ft')
    })
  })

  describe('formatDistance — metric', () => {
    it('renders zero as 0 m', () => {
      expect(formatDistance(0, 'metric')).toBe('0 m')
    })

    it('renders sub-km distances in meters rounded to nearest 10', () => {
      expect(formatDistance(123, 'metric')).toBe('120 m')
      expect(formatDistance(845, 'metric')).toBe('850 m')
    })

    it('renders just below 1 km in meters', () => {
      expect(formatDistance(999, 'metric')).toBe('1000 m')
    })

    it('renders at 1 km in km to one decimal', () => {
      expect(formatDistance(1000, 'metric')).toBe('1.0 km')
    })

    it('renders multi-km distances in km to one decimal', () => {
      expect(formatDistance(1899, 'metric')).toBe('1.9 km')
      expect(formatDistance(20000, 'metric')).toBe('20.0 km')
    })

    it('collapses negative meters to 0 m', () => {
      expect(formatDistance(-100, 'metric')).toBe('0 m')
    })
  })

  describe('formatSpeed — imperial', () => {
    it('renders zero as 0 mph', () => {
      expect(formatSpeed(0, 'imperial')).toBe('0 mph')
    })

    it('renders ~5 m/s as 11 mph', () => {
      // 5 m/s = 18000 m/h ÷ 1609.344 ≈ 11.185 mph → 11
      expect(formatSpeed(5, 'imperial')).toBe('11 mph')
    })

    it('collapses negative speed to 0 mph', () => {
      expect(formatSpeed(-3, 'imperial')).toBe('0 mph')
    })
  })

  describe('formatSpeed — metric', () => {
    it('renders zero as 0 km/h', () => {
      expect(formatSpeed(0, 'metric')).toBe('0 km/h')
    })

    it('renders ~5 m/s as 18 km/h', () => {
      // 5 m/s × 3600 / 1000 = 18 km/h
      expect(formatSpeed(5, 'metric')).toBe('18 km/h')
    })

    it('collapses NaN speed to 0 km/h', () => {
      expect(formatSpeed(NaN, 'metric')).toBe('0 km/h')
    })
  })
})
