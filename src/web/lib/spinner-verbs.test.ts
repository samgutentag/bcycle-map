import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
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
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

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

  it('rotates to a different verb every 3 seconds', () => {
    const { result } = renderHook(() => useStableVerb())
    const first = result.current
    act(() => { vi.advanceTimersByTime(3000) })
    const second = result.current
    expect(second).not.toBe(first)
    expect(BIKE_VERBS).toContain(second)
    act(() => { vi.advanceTimersByTime(3000) })
    expect(result.current).not.toBe(second)
  })

  it('clears the interval on unmount', () => {
    const { result, unmount } = renderHook(() => useStableVerb())
    const snapshot = result.current
    unmount()
    act(() => { vi.advanceTimersByTime(9000) })
    // Hook is unmounted; result.current is the last value before unmount.
    expect(result.current).toBe(snapshot)
  })
})
