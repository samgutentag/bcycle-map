import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { UNIT_SYSTEM_LS_KEY, UnitSystemProvider, useUnitSystem } from './useUnitSystem'

function wrap({ children }: { children: ReactNode }) {
  return <UnitSystemProvider>{children}</UnitSystemProvider>
}

describe('useUnitSystem', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('defaults to imperial when no preference is persisted', () => {
    const { result } = renderHook(() => useUnitSystem(), { wrapper: wrap })
    expect(result.current.unitSystem).toBe('imperial')
  })

  it('hydrates from localStorage when a metric preference exists', () => {
    window.localStorage.setItem(UNIT_SYSTEM_LS_KEY, 'metric')
    const { result } = renderHook(() => useUnitSystem(), { wrapper: wrap })
    expect(result.current.unitSystem).toBe('metric')
  })

  it('falls back to imperial when localStorage holds garbage', () => {
    window.localStorage.setItem(UNIT_SYSTEM_LS_KEY, 'furlongs')
    const { result } = renderHook(() => useUnitSystem(), { wrapper: wrap })
    expect(result.current.unitSystem).toBe('imperial')
  })

  it('round-trips the setter through localStorage', () => {
    const { result } = renderHook(() => useUnitSystem(), { wrapper: wrap })
    act(() => {
      result.current.setUnitSystem('metric')
    })
    expect(result.current.unitSystem).toBe('metric')
    expect(window.localStorage.getItem(UNIT_SYSTEM_LS_KEY)).toBe('metric')

    act(() => {
      result.current.setUnitSystem('imperial')
    })
    expect(result.current.unitSystem).toBe('imperial')
    expect(window.localStorage.getItem(UNIT_SYSTEM_LS_KEY)).toBe('imperial')
  })

  it('returns the default value when used outside a provider', () => {
    const { result } = renderHook(() => useUnitSystem())
    expect(result.current.unitSystem).toBe('imperial')
    // setUnitSystem is a no-op but should not throw
    expect(() => result.current.setUnitSystem('metric')).not.toThrow()
  })

  it('honours an explicit initialValue prop on the provider', () => {
    function metricWrap({ children }: { children: ReactNode }) {
      return <UnitSystemProvider initialValue="metric">{children}</UnitSystemProvider>
    }
    const { result } = renderHook(() => useUnitSystem(), { wrapper: metricWrap })
    expect(result.current.unitSystem).toBe('metric')
  })
})
