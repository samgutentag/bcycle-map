import { useEffect, useState } from 'react'
import type { Range } from '../lib/date-range'

type Args = {
  apiBase: string
  system: string
  range: Range
}

type State = {
  keys: string[] | null
  loading: boolean
  error: Error | null
}

/**
 * Hits the read-api Worker's /partitions endpoint to find which parquet keys
 * exist in R2 for the given time range. The frontend can then build SQL that
 * only references files that actually exist, avoiding 404s from DuckDB-WASM
 * when a glob would otherwise reach into hours that haven't been compacted yet.
 */
export function usePartitionKeys(args: Args): State {
  const [keys, setKeys] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const url = `${args.apiBase}/api/systems/${encodeURIComponent(args.system)}/partitions?from=${args.range.fromTs}&to=${args.range.toTs}`
    fetch(url).then(
      async res => {
        if (!res.ok) throw new Error(`partitions ${res.status}`)
        const body = await res.json() as { keys: string[] }
        if (!cancelled) {
          setKeys(body.keys)
          setLoading(false)
        }
      },
      e => {
        if (!cancelled) {
          setError(e as Error)
          setLoading(false)
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [args.apiBase, args.system, args.range.fromTs, args.range.toTs])

  return { keys, loading, error }
}
