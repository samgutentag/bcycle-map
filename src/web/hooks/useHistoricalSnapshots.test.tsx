import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import {
  useHistoricalSnapshots,
  nearestSnapshotByTs,
  type HistoricalSnapshot,
} from './useHistoricalSnapshots'
import * as api from '../lib/api'

const snap = (ts: number, bikes = 5, docks = 5): HistoricalSnapshot => ({
  ts,
  stations: [
    { station_id: 'a', num_bikes_available: bikes, num_docks_available: docks },
  ],
})

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useHistoricalSnapshots', () => {
  it('fetches once with the supplied window and exposes the snapshots', async () => {
    const fetchSpy = vi.spyOn(api, 'fetchHistoricalSnapshots').mockResolvedValue([
      snap(1000, 3, 7),
      snap(1120, 4, 6),
    ])

    const { result } = renderHook(() =>
      useHistoricalSnapshots('bcycle_santabarbara', 1000, 2000, 120),
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledWith('bcycle_santabarbara', 1000, 2000, 120)
    expect(result.current.snapshots).toHaveLength(2)
    expect(result.current.error).toBeNull()
  })

  it('starts in a loading state before the fetch resolves', async () => {
    let resolveFetch: (v: HistoricalSnapshot[]) => void = () => {}
    vi.spyOn(api, 'fetchHistoricalSnapshots').mockImplementation(
      () => new Promise<HistoricalSnapshot[]>(r => { resolveFetch = r }),
    )
    const { result } = renderHook(() =>
      useHistoricalSnapshots('bcycle_santabarbara', 1000, 2000),
    )
    // After mount we're loading and have no data yet
    await waitFor(() => expect(result.current.loading).toBe(true))
    expect(result.current.snapshots).toBeNull()
    expect(result.current.getSnapshotAt(1500)).toBeNull()
    // Finishing the fetch flips loading back off
    resolveFetch([snap(1000)])
    await waitFor(() => expect(result.current.loading).toBe(false))
  })

  it('does not fetch when the window is empty or unresolved', async () => {
    const fetchSpy = vi.spyOn(api, 'fetchHistoricalSnapshots').mockResolvedValue([])
    const { result } = renderHook(() =>
      useHistoricalSnapshots('bcycle_santabarbara', 0, 0),
    )
    // Nothing to do — windowEnd is 0, hook stays idle
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(false)
    expect(result.current.snapshots).toBeNull()
  })

  it('surfaces fetch errors', async () => {
    vi.spyOn(api, 'fetchHistoricalSnapshots').mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() =>
      useHistoricalSnapshots('bcycle_santabarbara', 1000, 2000),
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error?.message).toBe('boom')
    expect(result.current.snapshots).toBeNull()
  })

  describe('getSnapshotAt', () => {
    it('returns null when no snapshots are loaded yet', () => {
      // No fetch — bypass useEffect by giving an empty window
      const { result } = renderHook(() =>
        useHistoricalSnapshots('bcycle_santabarbara', 0, 0),
      )
      expect(result.current.getSnapshotAt(1000)).toBeNull()
    })

    it('returns the exact match when ts lines up with a snapshot', async () => {
      vi.spyOn(api, 'fetchHistoricalSnapshots').mockResolvedValue([
        snap(1000, 3),
        snap(1120, 4),
        snap(1240, 5),
      ])
      const { result } = renderHook(() =>
        useHistoricalSnapshots('bcycle_santabarbara', 1000, 1240, 120),
      )
      await waitFor(() => expect(result.current.snapshots).not.toBeNull())
      const stations = result.current.getSnapshotAt(1120)!
      expect(stations[0]!.num_bikes_available).toBe(4)
    })

    it('returns the nearest snapshot by bisect when between ticks', async () => {
      vi.spyOn(api, 'fetchHistoricalSnapshots').mockResolvedValue([
        snap(1000, 3),
        snap(1120, 4),
        snap(1240, 5),
      ])
      const { result } = renderHook(() =>
        useHistoricalSnapshots('bcycle_santabarbara', 1000, 1240, 120),
      )
      await waitFor(() => expect(result.current.snapshots).not.toBeNull())
      // ts=1100 — 100 past 1000, 20 before 1120 → nearer to 1120 (bikes=4)
      expect(result.current.getSnapshotAt(1100)![0]!.num_bikes_available).toBe(4)
      // ts=1050 — 50 past 1000, 70 before 1120 → nearer to 1000 (bikes=3)
      expect(result.current.getSnapshotAt(1050)![0]!.num_bikes_available).toBe(3)
    })

    it('clamps to the first snapshot when ts is before the window', async () => {
      vi.spyOn(api, 'fetchHistoricalSnapshots').mockResolvedValue([
        snap(1000, 3),
        snap(1120, 4),
      ])
      const { result } = renderHook(() =>
        useHistoricalSnapshots('bcycle_santabarbara', 1000, 1120),
      )
      await waitFor(() => expect(result.current.snapshots).not.toBeNull())
      expect(result.current.getSnapshotAt(500)![0]!.num_bikes_available).toBe(3)
    })

    it('clamps to the last snapshot when ts is after the window', async () => {
      vi.spyOn(api, 'fetchHistoricalSnapshots').mockResolvedValue([
        snap(1000, 3),
        snap(1120, 4),
      ])
      const { result } = renderHook(() =>
        useHistoricalSnapshots('bcycle_santabarbara', 1000, 1120),
      )
      await waitFor(() => expect(result.current.snapshots).not.toBeNull())
      expect(result.current.getSnapshotAt(99999)![0]!.num_bikes_available).toBe(4)
    })
  })
})

describe('nearestSnapshotByTs', () => {
  it('returns null on an empty list', () => {
    expect(nearestSnapshotByTs([], 100)).toBeNull()
  })

  it('handles a single-snapshot list', () => {
    const s = snap(100)
    expect(nearestSnapshotByTs([s], 50)).toBe(s)
    expect(nearestSnapshotByTs([s], 100)).toBe(s)
    expect(nearestSnapshotByTs([s], 9999)).toBe(s)
  })

  it('breaks midpoint ties toward the earlier snapshot', () => {
    const a = snap(100)
    const b = snap(200)
    // ts=150 is equidistant — the bisect prefers the earlier neighbor
    expect(nearestSnapshotByTs([a, b], 150)).toBe(a)
  })
})
