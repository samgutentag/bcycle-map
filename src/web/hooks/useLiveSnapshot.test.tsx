import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useLiveSnapshot } from './useLiveSnapshot'

const payload = {
  system: { system_id: 'bcycle_santabarbara', name: 'SB BCycle', timezone: 'America/Los_Angeles', language: 'en' },
  snapshot_ts: 1778692030,
  stations: [{ station_id: 'a', name: 'A', lat: 0, lon: 0, num_bikes_available: 1, num_docks_available: 1, bikes_electric: 1, bikes_classic: 0, bikes_smart: 0, is_installed: true, is_renting: true, is_returning: true, last_reported: 0 }],
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useLiveSnapshot', () => {
  it('fetches once on mount and exposes data', async () => {
    const { result } = renderHook(() => useLiveSnapshot('bcycle_santabarbara'))
    await waitFor(() => expect(result.current.data?.snapshot_ts).toBe(1778692030))
  })

  it('exposes ageSec relative to "now"', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(1778692030 * 1000 + 60_000))
    const { result } = renderHook(() => useLiveSnapshot('bcycle_santabarbara'))
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.ageSec).toBeGreaterThanOrEqual(60)
    expect(result.current.ageSec).toBeLessThan(70)
  })
})
