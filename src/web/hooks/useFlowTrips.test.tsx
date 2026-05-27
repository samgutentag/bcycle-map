import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useFlowTrips } from './useFlowTrips'
import * as api from '../lib/api'
import type { Trip } from '@shared/types'

const tripA: Trip = {
  departure_ts: 1000,
  arrival_ts: 1100,
  from_station_id: 'a',
  to_station_id: 'b',
  duration_sec: 100,
}

beforeEach(() => {
  // Anchor "now" so the 24h window always includes tripA at ts=1000
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date(2000 * 1000))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useFlowTrips', () => {
  it('uses fetchTrips for the default 24h window', async () => {
    const tripsSpy = vi.spyOn(api, 'fetchTrips').mockResolvedValue([tripA])

    const { result } = renderHook(() => useFlowTrips('bcycle_santabarbara'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(tripsSpy).toHaveBeenCalledTimes(1)
    const [systemArg, sinceArg, untilArg] = tripsSpy.mock.calls[0]!
    expect(systemArg).toBe('bcycle_santabarbara')
    expect(untilArg - sinceArg).toBe(24 * 3600)
    expect(result.current.trips).toEqual([tripA])
  })

  it('uses fetchTrips for a 7d window', async () => {
    const bulkTrip: Trip = { ...tripA, from_station_id: 'c', to_station_id: 'd' }
    const tripsSpy = vi.spyOn(api, 'fetchTrips').mockResolvedValue([bulkTrip])

    const sevenDays = 7 * 86400
    const { result } = renderHook(() => useFlowTrips('bcycle_santabarbara', sevenDays))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(tripsSpy).toHaveBeenCalledTimes(1)
    const [, sinceArg, untilArg] = tripsSpy.mock.calls[0]!
    expect(untilArg - sinceArg).toBe(sevenDays)
    expect(result.current.trips).toEqual([bulkTrip])
  })

  it('exposes a windowStart/windowEnd that match the requested window size', async () => {
    vi.spyOn(api, 'fetchTrips').mockResolvedValue([tripA])
    const { result } = renderHook(() => useFlowTrips('bcycle_santabarbara'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.windowEnd - result.current.windowStart).toBe(24 * 3600)
  })

  it('surfaces fetch errors', async () => {
    vi.spyOn(api, 'fetchTrips').mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useFlowTrips('bcycle_santabarbara'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error?.message).toBe('boom')
  })

  it('refetches when windowSeconds changes', async () => {
    const tripsSpy = vi.spyOn(api, 'fetchTrips').mockResolvedValue([])

    const { result, rerender } = renderHook(
      ({ secs }: { secs: number }) => useFlowTrips('bcycle_santabarbara', secs),
      { initialProps: { secs: 24 * 3600 } },
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(tripsSpy).toHaveBeenCalledTimes(1)

    rerender({ secs: 48 * 3600 })
    await waitFor(() => expect(tripsSpy).toHaveBeenCalledTimes(2))
    const [, sinceArg, untilArg] = tripsSpy.mock.calls[1]!
    expect(untilArg - sinceArg).toBe(48 * 3600)
  })

  it('filters out trips outside the requested window', async () => {
    // 100s window from fake "now" (2000s) → [1900, 2000]
    const stale: Trip = { ...tripA, departure_ts: 1500, arrival_ts: 1600 }  // both before windowStart
    const fresh: Trip = { ...tripA, departure_ts: 1950, arrival_ts: 1990 }  // inside the window
    vi.spyOn(api, 'fetchTrips').mockResolvedValue([stale, fresh])

    const { result } = renderHook(() => useFlowTrips('bcycle_santabarbara', 100))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.trips).toEqual([fresh])
  })
})
