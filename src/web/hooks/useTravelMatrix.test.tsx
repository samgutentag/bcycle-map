import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useTravelMatrix, lookupTravelTime, type TravelMatrix } from './useTravelMatrix'

const SAMPLE: TravelMatrix = {
  computedAt: 1700000000,
  stations: [
    { id: 'a', lat: 0, lon: 0 },
    { id: 'b', lat: 0, lon: 1 },
  ],
  edges: {
    a: { b: { minutes: 4, meters: 1200 } },
    b: { a: { minutes: 5, meters: 1500 } },
  },
}

describe('useTravelMatrix', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches and exposes the matrix', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(SAMPLE), { status: 200 })))
    const { result } = renderHook(() => useTravelMatrix('https://r2.example.com', 'bcycle_test'))
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual(SAMPLE)
    expect(result.current.error).toBeNull()
  })

  it('builds the URL from r2Base + systemId', async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify(SAMPLE), { status: 200 }))
    vi.stubGlobal('fetch', spy)
    renderHook(() => useTravelMatrix('https://r2.example.com', 'bcycle_test'))
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    expect(spy).toHaveBeenCalledWith('https://r2.example.com/gbfs/bcycle_test/travel-times.json')
  })

  it('exposes a fetch error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })))
    const { result } = renderHook(() => useTravelMatrix('https://r2.example.com', 'bcycle_test'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toMatch(/404/)
    expect(result.current.data).toBeNull()
  })

  it('exposes a parse error on malformed JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not valid json{{', { status: 200 })))
    const { result } = renderHook(() => useTravelMatrix('https://r2.example.com', 'bcycle_test'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.data).toBeNull()
  })
})

describe('lookupTravelTime', () => {
  it('returns the edge when both endpoints exist', () => {
    expect(lookupTravelTime(SAMPLE, 'a', 'b')).toEqual({ minutes: 4, meters: 1200 })
    expect(lookupTravelTime(SAMPLE, 'b', 'a')).toEqual({ minutes: 5, meters: 1500 })
  })

  it('returns null when the pair is missing', () => {
    expect(lookupTravelTime(SAMPLE, 'a', 'c')).toBeNull()
    expect(lookupTravelTime(SAMPLE, 'z', 'b')).toBeNull()
  })

  it('returns null when matrix or either id is missing', () => {
    expect(lookupTravelTime(null, 'a', 'b')).toBeNull()
    expect(lookupTravelTime(SAMPLE, null, 'b')).toBeNull()
    expect(lookupTravelTime(SAMPLE, 'a', null)).toBeNull()
    expect(lookupTravelTime(SAMPLE, undefined, undefined)).toBeNull()
  })
})
