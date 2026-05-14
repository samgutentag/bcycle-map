import { useEffect, useState } from 'react'
import { useDuckDB } from './useDuckDB'
import { usePartitionKeys } from './usePartitionKeys'
import { buildStationOverTimeQuery } from '../lib/queries'
import type { Range } from '../lib/date-range'
import type { LoadPhase } from './useTotalBikesOverTime'

export type StationOverTimeRow = {
  snapshot_ts: number
  bikes: number
  docks: number
}

type Args = {
  apiBase: string
  r2Base: string
  system: string
  stationId: string | null
  range: Range
}

const cache = new Map<string, StationOverTimeRow[]>()

function cacheKey(args: Args, keys: string[]): string {
  return `${args.r2Base}|${args.system}|${args.stationId}|${args.range.fromTs}|${args.range.toTs}|${keys.join(',')}`
}

export function useStationOverTime(args: Args) {
  const { conn, loading: dbLoading, error: dbError } = useDuckDB()
  const partitionsArgs = { apiBase: args.apiBase, system: args.system, range: args.range }
  const { keys, loading: partsLoading, error: partsError } = usePartitionKeys(partitionsArgs)
  const [data, setData] = useState<StationOverTimeRow[] | null>(null)
  const [queryLoading, setQueryLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!args.stationId) {
      setData(null)
      setQueryLoading(false)
      return
    }
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
    const sql = buildStationOverTimeQuery({
      range: args.range,
      urls,
      stationId: args.stationId,
    })
    conn.query(sql).then(
      result => {
        if (cancelled) return
        const rows = result.toArray().map((r: any) => ({
          snapshot_ts: Number(r.snapshot_ts),
          bikes: Number(r.bikes),
          docks: Number(r.docks),
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
  }, [conn, keys, args.r2Base, args.stationId, args.range.fromTs, args.range.toTs])

  const phase: LoadPhase = !args.stationId
    ? 'idle'
    : dbError || partsError || error
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
    loading: !!args.stationId && (dbLoading || partsLoading || queryLoading),
    phase,
    error: dbError || partsError || error,
  }
}
