import { useEffect, useState } from 'react'
import { fetchActivity } from '../lib/api'
import type { ActivityLog } from '@shared/types'

const REFRESH_MS = 30_000

export type ActivityState = {
  data: ActivityLog | null
  error: Error | null
}

export function useActivity(systemId: string): ActivityState {
  const [data, setData] = useState<ActivityLog | null>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const v = await fetchActivity(systemId)
        if (!cancelled) {
          setData(v)
          setError(null)
        }
      } catch (e) {
        if (!cancelled) setError(e as Error)
      }
    }
    tick()
    const timer = setInterval(tick, REFRESH_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [systemId])

  return { data, error }
}
