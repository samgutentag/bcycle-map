import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useLeaderboards } from './useLeaderboards'
import type { Leaderboards } from '@shared/leaderboards'

const SAMPLE: Leaderboards = {
  generated_at: 1_700_000_000,
  windows: {
    '30d': {
      stations: [{ station_id: 's1', departures: 10, arrivals: 12, total: 22 }],
      routes: [{ from: 's1', to: 's2', trips: 7 }],
    },
    all: {
      stations: [{ station_id: 's1', departures: 100, arrivals: 110, total: 210 }],
      routes: [{ from: 's1', to: 's2', trips: 42 }],
    },
  },
}

describe('useLeaderboards', () => {
  beforeEach(() => { vi.restoreAllMocks() })
  afterEach(() => { vi.restoreAllMocks() })

  it('fetches and exposes the rollup', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(SAMPLE), { status: 200 })))
    const { result } = renderHook(() => useLeaderboards('https://r2.example.com', 'bcycle_test'))
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual(SAMPLE)
    expect(result.current.error).toBeNull()
  })

  it('builds the URL from r2Base + systemId', async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify(SAMPLE), { status: 200 }))
    vi.stubGlobal('fetch', spy)
    renderHook(() => useLeaderboards('https://r2.example.com', 'bcycle_test'))
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    expect(spy).toHaveBeenCalledWith('https://r2.example.com/gbfs/bcycle_test/leaderboards.json')
  })

  it('exposes the http error when the fetch is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })))
    const { result } = renderHook(() => useLeaderboards('https://r2.example.com', 'bcycle_test'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toMatch(/404/)
    expect(result.current.data).toBeNull()
  })

  it('exposes a parse error on malformed JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{{not-json', { status: 200 })))
    const { result } = renderHook(() => useLeaderboards('https://r2.example.com', 'bcycle_test'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.data).toBeNull()
  })

  it('exposes loading=true on initial render before the fetch resolves', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const { result } = renderHook(() => useLeaderboards('https://r2.example.com', 'bcycle_test'))
    expect(result.current.loading).toBe(true)
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBeNull()
  })
})
