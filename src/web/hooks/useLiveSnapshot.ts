import { useEffect, useState } from 'react'
import { fetchCurrent } from '../lib/api'
import type { KVValue } from '@shared/types'

const REFRESH_MS = 60_000

type State = {
  data: KVValue | null
  ageSec: number
  error: Error | null
}

export function useLiveSnapshot(systemId: string): State {
  const [data, setData] = useState<KVValue | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const v = await fetchCurrent(systemId)
        if (!cancelled) {
          setData(v)
          setError(null)
        }
      } catch (e) {
        if (!cancelled) setError(e as Error)
      }
    }
    tick()
    const fetchTimer = setInterval(tick, REFRESH_MS)
    const clockTimer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => { cancelled = true; clearInterval(fetchTimer); clearInterval(clockTimer) }
  }, [systemId])

  const ageSec = data ? Math.max(0, now - data.snapshot_ts) : 0
  return { data, ageSec, error }
}
