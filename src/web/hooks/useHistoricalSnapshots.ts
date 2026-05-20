import { useEffect, useMemo, useState } from 'react'
import {
  fetchHistoricalSnapshots,
  type HistoricalSnapshot,
  type StationSnapshotCount,
} from '../lib/api'

/**
 * Historical pin rewind data for /flow (#52).
 *
 * Fetches the full [windowStart, windowEnd] range once per page load at
 * the configured cadence (default 120s) and returns `getSnapshotAt(ts)`
 * — a binary-search selector that finds the nearest snapshot by ts.
 *
 * The data is immutable once written (poller → compaction → R2 parquet)
 * and the worker caches at max-age=600, so a single fetch + a client
 * bisect is enough. FlowMap calls the selector on every cursor change
 * to refresh pin counts.
 *
 * `getSnapshotAt` returns `null` when no snapshots are loaded yet, so
 * the call site can fall back to live counts during the initial fetch.
 */

export type HistoricalSnapshotsState = {
  snapshots: HistoricalSnapshot[] | null
  loading: boolean
  error: Error | null
  getSnapshotAt: (ts: number) => StationSnapshotCount[] | null
}

const NULL_GETTER = (): StationSnapshotCount[] | null => null

/**
 * Binary-search for the nearest snapshot by ts. Ties prefer the earlier
 * snapshot — when the cursor sits exactly between two ticks the user is
 * looking at "this moment or just before", which lines up with how
 * scrubbing actually feels.
 */
export function nearestSnapshotByTs(
  snapshots: HistoricalSnapshot[],
  ts: number,
): HistoricalSnapshot | null {
  if (snapshots.length === 0) return null
  if (ts <= snapshots[0]!.ts) return snapshots[0]!
  if (ts >= snapshots[snapshots.length - 1]!.ts) return snapshots[snapshots.length - 1]!
  let lo = 0
  let hi = snapshots.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (snapshots[mid]!.ts <= ts) lo = mid
    else hi = mid
  }
  const before = snapshots[lo]!
  const after = snapshots[hi]!
  return ts - before.ts <= after.ts - ts ? before : after
}

export function useHistoricalSnapshots(
  systemId: string,
  windowStart: number,
  windowEnd: number,
  stepSec = 120,
): HistoricalSnapshotsState {
  const [snapshots, setSnapshots] = useState<HistoricalSnapshot[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    // The hook only kicks off once the window resolves to a non-empty range.
    // FlowMap mounts with windowEnd=0 until useFlowTrips populates it.
    if (windowStart <= 0 || windowEnd <= 0 || windowEnd <= windowStart) {
      return
    }
    let cancelled = false
    setLoading(true)
    fetchHistoricalSnapshots(systemId, windowStart, windowEnd, stepSec)
      .then(snaps => {
        if (cancelled) return
        setSnapshots(snaps)
        setError(null)
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err as Error)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [systemId, windowStart, windowEnd, stepSec])

  const getSnapshotAt = useMemo(() => {
    if (!snapshots || snapshots.length === 0) return NULL_GETTER
    return (ts: number) => {
      const snap = nearestSnapshotByTs(snapshots, ts)
      return snap ? snap.stations : null
    }
  }, [snapshots])

  return useMemo(
    () => ({ snapshots, loading, error, getSnapshotAt }),
    [snapshots, loading, error, getSnapshotAt],
  )
}

// Re-exported here so the hook's public surface is self-contained — call
// sites don't need to also import from lib/api.
export type { HistoricalSnapshot, StationSnapshotCount }
