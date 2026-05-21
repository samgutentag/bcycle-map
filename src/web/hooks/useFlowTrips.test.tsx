import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useFlowTrips } from './useFlowTrips'
import * as api from '../lib/api'
import type { ActivityLog, Trip } from '@shared/types'

const tripA: Trip = {
  departure_ts: 1000,
  arrival_ts: 1100,
  from_station_id: 'a',
  to_station_id: 'b',
  duration_sec: 100,
}

const activityPayload: ActivityLog = {
  events: [],
  trips: [tripA],
  inFlightFromStationId: null,
  inFlightDepartureTs: null,
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
  it('uses fetchActivity for the default 24h window (≤ threshold)', async () => {
    const activitySpy = vi.spyOn(api, 'fetchActivity').mockResolvedValue(activityPayload)
    const tripsSpy = vi.spyOn(api, 'fetchTrips').mockResolvedValue([])

    const { result } = renderHook(() => useFlowTrips('bcycle_santabarbara'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(activitySpy).toHaveBeenCalledTimes(1)
    expect(tripsSpy).not.toHaveBeenCalled()
    expect(result.current.trips).toEqual([tripA])
  })

  it('uses fetchTrips when the window exceeds 24h', async () => {
    const activitySpy = vi.spyOn(api, 'fetchActivity').mockResolvedValue(activityPayload)
    const bulkTrip: Trip = { ...tripA, from_station_id: 'c', to_station_id: 'd' }
    const tripsSpy = vi.spyOn(api, 'fetchTrips').mockResolvedValue([bulkTrip])

    const sevenDays = 7 * 86400
    const { result } = renderHook(() => useFlowTrips('bcycle_santabarbara', sevenDays))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(tripsSpy).toHaveBeenCalledTimes(1)
    expect(activitySpy).not.toHaveBeenCalled()
    // Bulk endpoint was called with [now - 7d, now]
    const [systemArg, sinceArg, untilArg] = tripsSpy.mock.calls[0]!
    expect(systemArg).toBe('bcycle_santabarbara')
    expect(untilArg - sinceArg).toBe(sevenDays)
    expect(result.current.trips).toEqual([bulkTrip])
  })

  it('exposes a windowStart/windowEnd that match the requested window size', async () => {
    vi.spyOn(api, 'fetchActivity').mockResolvedValue(activityPayload)
    const { result } = renderHook(() => useFlowTrips('bcycle_santabarbara'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.windowEnd - result.current.windowStart).toBe(24 * 3600)
  })

  it('surfaces fetch errors on either path', async () => {
    vi.spyOn(api, 'fetchActivity').mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useFlowTrips('bcycle_santabarbara'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error?.message).toBe('boom')
  })

  it('surfaces fetchTrips errors when on the bulk path', async () => {
    vi.spyOn(api, 'fetchTrips').mockRejectedValue(new Error('bulk failed'))
    const { result } = renderHook(() => useFlowTrips('bcycle_santabarbara', 48 * 3600))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error?.message).toBe('bulk failed')
  })

  it('switches branches when windowSeconds changes across the threshold', async () => {
    const activitySpy = vi.spyOn(api, 'fetchActivity').mockResolvedValue(activityPayload)
    const tripsSpy = vi.spyOn(api, 'fetchTrips').mockResolvedValue([])

    const { result, rerender } = renderHook(
      ({ secs }: { secs: number }) => useFlowTrips('bcycle_santabarbara', secs),
      { initialProps: { secs: 24 * 3600 } },
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(activitySpy).toHaveBeenCalledTimes(1)
    expect(tripsSpy).toHaveBeenCalledTimes(0)

    rerender({ secs: 48 * 3600 })
    await waitFor(() => expect(tripsSpy).toHaveBeenCalled())
    // activity wasn't called again — we're on the bulk path now
    expect(activitySpy).toHaveBeenCalledTimes(1)
  })
})
