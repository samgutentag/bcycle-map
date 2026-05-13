import { describe, it, expect } from 'vitest'
import { markerColor, markerSize, pctAvailable } from './marker-style'

describe('pctAvailable', () => {
  it('returns 0 when no bikes', () => {
    expect(pctAvailable({ bikes: 0, docks: 10 })).toBe(0)
  })
  it('returns 1 when no docks open', () => {
    expect(pctAvailable({ bikes: 10, docks: 0 })).toBe(1)
  })
  it('returns 0.5 for balanced', () => {
    expect(pctAvailable({ bikes: 5, docks: 5 })).toBe(0.5)
  })
  it('returns 0 when station has zero total capacity (avoid divide-by-zero)', () => {
    expect(pctAvailable({ bikes: 0, docks: 0 })).toBe(0)
  })
})

describe('markerColor', () => {
  it('returns red-ish for empty stations', () => {
    expect(markerColor(0)).toMatch(/#/)
  })
  it('returns green-ish for fully available stations', () => {
    expect(markerColor(1)).toMatch(/#/)
  })
})

describe('markerSize', () => {
  it('scales with total docks', () => {
    expect(markerSize(5)).toBeLessThan(markerSize(20))
  })
  it('clamps to a sane minimum', () => {
    expect(markerSize(0)).toBeGreaterThanOrEqual(6)
  })
})
