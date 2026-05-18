import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useGeolocation } from './useGeolocation'

type SuccessCb = (pos: { coords: { latitude: number; longitude: number; accuracy: number } }) => void
type ErrorCb = (err: { code: number; message: string }) => void

function installGeolocation(impl: (success: SuccessCb, error: ErrorCb) => void) {
  // navigator.geolocation is a read-only accessor in happy-dom; redefine the
  // property with a writable value so each test can swap implementations.
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (success: SuccessCb, error: ErrorCb) => impl(success, error),
      watchPosition: () => 0,
      clearWatch: () => {},
    },
  })
}

function removeGeolocation() {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: undefined,
  })
}

describe('useGeolocation', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    removeGeolocation()
    vi.restoreAllMocks()
  })

  it('starts in the idle state with no coords', () => {
    installGeolocation(() => {})
    const { result } = renderHook(() => useGeolocation())
    expect(result.current.status).toBe('idle')
    expect(result.current.coords).toBeNull()
    expect(result.current.previouslyGranted).toBe(false)
  })

  it('reports unavailable when the browser has no geolocation API', () => {
    removeGeolocation()
    const { result } = renderHook(() => useGeolocation())
    act(() => { result.current.request() })
    expect(result.current.status).toBe('unavailable')
    expect(result.current.error).toMatch(/not supported/i)
  })

  it('transitions to granted on a successful position fix and caches the grant', () => {
    installGeolocation(success => {
      success({ coords: { latitude: 34.4208, longitude: -119.6982, accuracy: 12 } })
    })
    const { result } = renderHook(() => useGeolocation())
    act(() => { result.current.request() })
    expect(result.current.status).toBe('granted')
    expect(result.current.coords).toEqual({ lat: 34.4208, lon: -119.6982, accuracy: 12 })
    expect(window.localStorage.getItem('bcycle-map:geolocation-granted')).toBe('1')
  })

  it('transitions to denied on PERMISSION_DENIED and clears any cached grant', () => {
    window.localStorage.setItem('bcycle-map:geolocation-granted', '1')
    installGeolocation((_success, error) => {
      error({ code: 1, message: 'User denied geolocation.' })
    })
    const { result } = renderHook(() => useGeolocation())
    act(() => { result.current.request() })
    expect(result.current.status).toBe('denied')
    expect(window.localStorage.getItem('bcycle-map:geolocation-granted')).toBeNull()
  })

  it('transitions to unavailable on POSITION_UNAVAILABLE / TIMEOUT', () => {
    installGeolocation((_success, error) => {
      error({ code: 3, message: 'Timed out.' })
    })
    const { result } = renderHook(() => useGeolocation())
    act(() => { result.current.request() })
    expect(result.current.status).toBe('unavailable')
    expect(result.current.error).toMatch(/timed out/i)
  })

  it('hydrates previouslyGranted from localStorage on mount', () => {
    window.localStorage.setItem('bcycle-map:geolocation-granted', '1')
    installGeolocation(() => {})
    const { result } = renderHook(() => useGeolocation())
    expect(result.current.previouslyGranted).toBe(true)
  })

  it('reset clears the cached grant and returns to idle', () => {
    installGeolocation(success => {
      success({ coords: { latitude: 34.4208, longitude: -119.6982, accuracy: 12 } })
    })
    const { result } = renderHook(() => useGeolocation())
    act(() => { result.current.request() })
    expect(result.current.status).toBe('granted')
    act(() => { result.current.reset() })
    expect(result.current.status).toBe('idle')
    expect(result.current.coords).toBeNull()
    expect(window.localStorage.getItem('bcycle-map:geolocation-granted')).toBeNull()
  })
})
