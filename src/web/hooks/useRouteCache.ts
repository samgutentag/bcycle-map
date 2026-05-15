import { useEffect, useState } from 'react'
import type { RouteCache } from '@shared/route-cache'

export type RouteCacheState = {
  data: RouteCache | null
  loading: boolean
  error: Error | null
}

export function useRouteCache(r2Base: string, systemId: string): RouteCacheState {
  const [data, setData] = useState<RouteCache | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    const url = `${r2Base}/gbfs/${systemId}/routes.json`
    setLoading(true)
    setError(null)
    fetch(url)
      .then(async r => {
        if (!r.ok) throw new Error(`routes fetch failed: ${r.status}`)
        return r.json() as Promise<RouteCache>
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
