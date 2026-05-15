import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { BIKE_VERBS, getRandomVerb, useStableVerb } from './spinner-verbs'

describe('BIKE_VERBS', () => {
  it('is a non-empty array of strings', () => {
    expect(Array.isArray(BIKE_VERBS)).toBe(true)
    expect(BIKE_VERBS.length).toBeGreaterThan(0)
    expect(typeof BIKE_VERBS[0]).toBe('string')
  })

  it('every entry ends with an ellipsis', () => {
    for (const v of BIKE_VERBS) {
      expect(v).toMatch(/…$/)
    }
  })
})

describe('getRandomVerb', () => {
  it('returns a member of BIKE_VERBS', () => {
    for (let i = 0; i < 20; i++) {
      expect(BIKE_VERBS).toContain(getRandomVerb())
    }
  })
})

describe('useStableVerb', () => {
  it('returns a string from BIKE_VERBS', () => {
    const { result } = renderHook(() => useStableVerb())
    expect(BIKE_VERBS).toContain(result.current)
  })

  it('returns the same string across re-renders within one mount', () => {
    const { result, rerender } = renderHook(() => useStableVerb())
    const first = result.current
    rerender()
    rerender()
    rerender()
    expect(result.current).toBe(first)
  })
})
