import { useEffect, useRef, useState } from 'react'
import type { Leaderboards } from '@shared/leaderboards'

export type LeaderboardsState = {
  data: Leaderboards | null
  loading: boolean
  error: Error | null
}

/**
 * Fetches gbfs/{systemId}/leaderboards.json once per mount and caches the
 * response in a ref so re-renders don't re-fetch. Mirrors useTravelMatrix /
 * useRoutePopularity in shape; component code stays consistent.
 */
export function useLeaderboards(r2Base: string, systemId: string): LeaderboardsState {
  const [data, setData] = useState<Leaderboards | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const cacheRef = useRef<{ url: string; data: Leaderboards } | null>(null)

  useEffect(() => {
    let cancelled = false
    const url = `${r2Base}/gbfs/${systemId}/leaderboards.json`

    if (cacheRef.current && cacheRef.current.url === url) {
      setData(cacheRef.current.data)
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)
    fetch(url)
      .then(async r => {
        if (!r.ok) throw new Error(`leaderboards fetch failed: ${r.status}`)
        return r.json() as Promise<Leaderboards>
      })
      .then(json => {
        if (cancelled) return
        cacheRef.current = { url, data: json }
        setData(json)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e : new Error(String(e)))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [r2Base, systemId])

  return { data, loading, error }
}
