import { useEffect, useState } from 'react'
import type { CorridorArtifact } from '@shared/corridors'

export type CorridorsState = { data: CorridorArtifact | null; loading: boolean }

/**
 * Load the active system's corridor artifact from R2. A missing artifact
 * (404 — e.g. a freshly-added system before the corridors workflow runs) is
 * treated as "no corridors", not an error: the chip filter simply hides.
 */
export function useCorridors(r2Base: string, systemId: string): CorridorsState {
  const [data, setData] = useState<CorridorArtifact | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setData(null)
    fetch(`${r2Base}/gbfs/${systemId}/corridors.json`)
      .then(async r => (r.ok ? ((await r.json()) as CorridorArtifact) : null))
      .then(json => { if (!cancelled) { setData(json); setLoading(false) } })
      .catch(() => { if (!cancelled) { setData(null); setLoading(false) } })
    return () => { cancelled = true }
  }, [r2Base, systemId])

  return { data, loading }
}
