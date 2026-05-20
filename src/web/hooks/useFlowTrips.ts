import { useEffect, useMemo, useState } from 'react'
import { fetchActivity } from '../lib/api'
import type { ActivityLog, Trip } from '@shared/types'

/**
 * Trips to animate on the flow map. v1 sources from the same rolling
 * activity log used by the live page — the poller caps it to roughly the
 * last 50 trips, so on quiet days that's our universe. Once a dedicated
 * historical-trips endpoint lands (see follow-up issue), this hook can
 * widen the window without the rest of the page caring.
 *
 * Why a hook of its own (not just reusing useActivity): the flow page only
 * wants the `trips` array, and it filters by a window ending at "now"
 * regardless of cursor position — so the call site is cleaner if we
 * encapsulate it. Easier to swap in a `?since=&until=` endpoint later.
 */

const REFRESH_MS = 60_000

export type FlowTripsState = {
  trips: Trip[]
  windowStart: number  // unix seconds, lower bound of the visible 24h window
  windowEnd: number    // unix seconds, upper bound — "now" at fetch time
  loading: boolean
  error: Error | null
}

export function useFlowTrips(systemId: string, windowSeconds = 24 * 3600): FlowTripsState {
  const [data, setData] = useState<ActivityLog | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchedAt, setFetchedAt] = useState<number>(() => Math.floor(Date.now() / 1000))

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const v = await fetchActivity(systemId)
        if (!cancelled) {
          setData(v)
          setFetchedAt(Math.floor(Date.now() / 1000))
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
  }, [systemId])

  return useMemo(() => {
    const windowEnd = fetchedAt
    const windowStart = windowEnd - windowSeconds
    const trips = (data?.trips ?? []).filter(
      t => t.departure_ts >= windowStart && t.departure_ts <= windowEnd,
    )
    return { trips, windowStart, windowEnd, loading, error }
  }, [data, fetchedAt, windowSeconds, loading, error])
}
