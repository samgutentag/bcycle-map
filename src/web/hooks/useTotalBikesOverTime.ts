import { useEffect, useState } from 'react'
import { useDuckDB } from './useDuckDB'
import { usePartitionKeys } from './usePartitionKeys'
import { buildTotalBikesQuery } from '../lib/queries'
import type { Range } from '../lib/date-range'

export type TotalBikesRow = {
  snapshot_ts: number
  total_bikes: number
  total_docks: number
}

type Args = {
  apiBase: string
  r2Base: string
  system: string
  range: Range
}

export type LoadPhase = 'init' | 'partitions' | 'query' | 'ready' | 'idle'

// Module-level cache survives re-mounts and preset toggles. Cleared on full page reload.
const cache = new Map<string, TotalBikesRow[]>()

function cacheKey(args: Args, keys: string[]): string {
  return `${args.r2Base}|${args.system}|${args.range.fromTs}|${args.range.toTs}|${keys.join(',')}`
}

export function useTotalBikesOverTime(args: Args) {
  const { conn, loading: dbLoading, error: dbError } = useDuckDB()
  const { keys, loading: partsLoading, error: partsError } = usePartitionKeys({
    apiBase: args.apiBase,
    system: args.system,
    range: args.range,
  })
  const [data, setData] = useState<TotalBikesRow[] | null>(null)
  const [queryLoading, setQueryLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!conn || !keys) return
    let cancelled = false
    const key = cacheKey(args, keys)
    const cached = cache.get(key)
    if (cached) {
      setData(cached)
      setQueryLoading(false)
      return
    }
    setQueryLoading(true)
    const urls = keys.map(k => `${args.r2Base}/${k}`)
    const sql = buildTotalBikesQuery({ range: args.range, urls })
    conn.query(sql).then(
      result => {
        if (cancelled) return
        const rows = result.toArray().map((r: any) => ({
          snapshot_ts: Number(r.snapshot_ts),
          total_bikes: Number(r.total_bikes),
          total_docks: Number(r.total_docks),
        }))
        cache.set(key, rows)
        setData(rows)
        setQueryLoading(false)
      },
      e => {
        if (cancelled) return
        setError(e as Error)
        setQueryLoading(false)
      },
    )
    return () => { cancelled = true }
  }, [conn, keys, args.r2Base, args.range.fromTs, args.range.toTs])

  const phase: LoadPhase = dbError || partsError || error
    ? 'idle'
    : dbLoading
      ? 'init'
      : partsLoading
        ? 'partitions'
        : queryLoading
          ? 'query'
          : 'ready'

  return {
    data,
    loading: dbLoading || partsLoading || queryLoading,
    phase,
    error: dbError || partsError || error,
  }
}
