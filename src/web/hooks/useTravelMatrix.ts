import { useEffect, useState } from 'react'

export type TravelMatrixStation = { id: string; lat: number; lon: number }
export type TravelEdge = { minutes: number; meters: number }
export type TravelMatrix = {
  computedAt: number
  stations: TravelMatrixStation[]
  edges: Record<string, Record<string, TravelEdge>>
}

export type TravelMatrixState = {
  data: TravelMatrix | null
  loading: boolean
  error: Error | null
}

export function useTravelMatrix(r2Base: string, systemId: string): TravelMatrixState {
  const [data, setData] = useState<TravelMatrix | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    const url = `${r2Base}/gbfs/${systemId}/travel-times.json`
    setLoading(true)
    setError(null)
    fetch(url)
      .then(async r => {
        if (!r.ok) throw new Error(`travel-times fetch failed: ${r.status}`)
        return r.json() as Promise<TravelMatrix>
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

export function lookupTravelTime(
  matrix: TravelMatrix | null,
  fromId: string | null | undefined,
  toId: string | null | undefined,
): TravelEdge | null {
  if (!matrix || !fromId || !toId) return null
  return matrix.edges[fromId]?.[toId] ?? null
}
