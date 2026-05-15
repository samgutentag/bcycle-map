import { useEffect, useState } from 'react'
import type { Popularity } from '@shared/popularity'

export type RoutePopularityState = {
  data: Popularity | null
  loading: boolean
  error: Error | null
}

export function useRoutePopularity(r2Base: string, systemId: string): RoutePopularityState {
  const [data, setData] = useState<Popularity | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    const url = `${r2Base}/gbfs/${systemId}/popularity.json`
    setLoading(true)
    setError(null)
    fetch(url)
      .then(async r => {
        if (!r.ok) throw new Error(`popularity fetch failed: ${r.status}`)
        return r.json() as Promise<Popularity>
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
  }, [r2Base, systemId])

  return { data, loading, error }
}
