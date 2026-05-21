import { useEffect, useMemo, useState } from 'react'
import { fetchTrips } from '../lib/api'
import type { Trip } from '@shared/types'

/**
 * Trips to animate on the flow map.
 *
 * Pulls from the bulk trips endpoint (#53) — re-derives trips from the
 * snapshot parquet archive for the requested [since, until] window. The
 * worker caches the response (cache-control: max-age=60) so subsequent
 * loads inside the same edge cache window are free.
 *
 * The previous implementation used the rolling ~50-trip activity log for
 * windows ≤24h to avoid the R2 hit. In practice that meant the visible
 * window on /flow shrank to whatever the activity log happened to cover —
 * often only the last 2-3 hours on a busy day, after the dynamic-window
 * compression in #56. Always using the bulk endpoint trades ~24 R2 GETs
 * per cold load for a full 24h of trips, which is what you actually want
 * on /flow.
 */

const REFRESH_MS = 60_000

export type FlowTripsState = {
  trips: Trip[]
  windowStart: number  // unix seconds, lower bound of the visible window
  windowEnd: number    // unix seconds, upper bound — "now" at fetch time
  loading: boolean
  error: Error | null
}

export function useFlowTrips(systemId: string, windowSeconds = 24 * 3600): FlowTripsState {
  const [trips, setTrips] = useState<Trip[] | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchedAt, setFetchedAt] = useState<number>(() => Math.floor(Date.now() / 1000))

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const nowSec = Math.floor(Date.now() / 1000)
        const sinceTs = nowSec - windowSeconds
        const v = await fetchTrips(systemId, sinceTs, nowSec)
        if (!cancelled) {
          setTrips(v)
          setFetchedAt(nowSec)
          setError(null)
          setLoading(false)
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
  }, [systemId, windowSeconds])

  return useMemo(() => {
    const windowEnd = fetchedAt
    const windowStart = windowEnd - windowSeconds
    const visible = (trips ?? []).filter(
      t => t.departure_ts >= windowStart && t.departure_ts <= windowEnd,
    )
    return { trips: visible, windowStart, windowEnd, loading, error }
  }, [trips, fetchedAt, windowSeconds, loading, error])
}
