import { useEffect, useMemo, useState } from 'react'
import { fetchActivity, fetchTrips } from '../lib/api'
import type { ActivityLog, Trip } from '@shared/types'

/**
 * Trips to animate on the flow map.
 *
 * Two source paths, chosen by window size:
 *
 *  - **≤24h (default)**: read the same rolling activity log the live page
 *    uses. The poller maintains it cheaply (one R2 object, capped at ~50
 *    trips system-wide); on quiet days that's usually a full day. This is
 *    the default /flow window, so this is the hot path.
 *
 *  - **>24h**: call the bulk trips endpoint (#53) which re-derives trips
 *    from the snapshot parquet archive for the requested [since, until]
 *    window. More expensive, but uncapped — needed for the 7d window
 *    spec'd as a /flow follow-up.
 *
 * The switch happens here so call sites stay agnostic; FlowMap still just
 * asks for `useFlowTrips(systemId)`.
 */

const REFRESH_MS = 60_000

/** Threshold above which we switch from activity-log to bulk endpoint. */
export const BULK_ENDPOINT_THRESHOLD_SEC = 24 * 3600

export type FlowTripsState = {
  trips: Trip[]
  windowStart: number  // unix seconds, lower bound of the visible window
  windowEnd: number    // unix seconds, upper bound — "now" at fetch time
  loading: boolean
  error: Error | null
}

export function useFlowTrips(systemId: string, windowSeconds = 24 * 3600): FlowTripsState {
  const useBulk = windowSeconds > BULK_ENDPOINT_THRESHOLD_SEC

  const [activityData, setActivityData] = useState<ActivityLog | null>(null)
  const [bulkTrips, setBulkTrips] = useState<Trip[] | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchedAt, setFetchedAt] = useState<number>(() => Math.floor(Date.now() / 1000))

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const nowSec = Math.floor(Date.now() / 1000)
        if (useBulk) {
          const sinceTs = nowSec - windowSeconds
          const trips = await fetchTrips(systemId, sinceTs, nowSec)
          if (!cancelled) {
            setBulkTrips(trips)
            setActivityData(null)
            setFetchedAt(nowSec)
            setError(null)
            setLoading(false)
          }
        } else {
          const v = await fetchActivity(systemId)
          if (!cancelled) {
            setActivityData(v)
            setBulkTrips(null)
            setFetchedAt(nowSec)
            setError(null)
            setLoading(false)
          }
        }
      } catch (e) {
        if (!cancelled) {
          setError(e as Error)
          setLoading(false)
        }
      }
    }
    setLoading(true)
    tick()
    const timer = setInterval(tick, REFRESH_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [systemId, windowSeconds, useBulk])

  return useMemo(() => {
    const windowEnd = fetchedAt
    const windowStart = windowEnd - windowSeconds
    const source = useBulk
      ? (bulkTrips ?? [])
      : (activityData?.trips ?? [])
    const trips = source.filter(
      t => t.departure_ts >= windowStart && t.departure_ts <= windowEnd,
    )
    return { trips, windowStart, windowEnd, loading, error }
  }, [useBulk, activityData, bulkTrips, fetchedAt, windowSeconds, loading, error])
}
