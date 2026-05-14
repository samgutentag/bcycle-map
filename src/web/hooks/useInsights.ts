import { useEffect, useState } from 'react'

const API_BASE = import.meta.env.VITE_API_BASE ?? ''

export type BeaconEvent = {
  ts: number
  path: string
  referrer: string | null
  country: string | null
  session: string | null
  viewport: string | null
}

export type InsightsState = {
  data: { events: BeaconEvent[]; days: number } | null
  loading: boolean
  error: Error | null
}

export function useInsights(days: number): InsightsState {
  const [data, setData] = useState<{ events: BeaconEvent[]; days: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`${API_BASE}/api/insights?days=${days}`)
      .then(async r => {
        if (!r.ok) throw new Error(`insights fetch failed: ${r.status}`)
        return r.json() as Promise<{ events: BeaconEvent[]; days: number }>
      })
      .then(json => {
        if (cancelled) return
        setData(json)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e : new Error(String(e)))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [days])

  return { data, loading, error }
}
