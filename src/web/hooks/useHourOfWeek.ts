import { useEffect, useState } from 'react'
import { useDuckDB } from './useDuckDB'
import { usePartitionKeys } from './usePartitionKeys'
import { buildHourOfWeekQuery } from '../lib/queries'
import type { Range } from '../lib/date-range'
import type { LoadPhase } from './useTotalBikesOverTime'

export type HourOfWeekRow = {
  dow: number
  hod: number
  avg_bikes: number
  samples: number
}

type Args = {
  apiBase: string
  r2Base: string
  system: string
  range: Range
  timezone?: string
}

const cache = new Map<string, HourOfWeekRow[]>()

function cacheKey(args: Args, keys: string[]): string {
  return `${args.r2Base}|${args.system}|${args.range.fromTs}|${args.range.toTs}|${args.timezone ?? 'UTC'}|${keys.join(',')}`
}

export function useHourOfWeek(args: Args) {
  const { conn, loading: dbLoading, error: dbError } = useDuckDB()
  const { keys, loading: partsLoading, error: partsError } = usePartitionKeys({
    apiBase: args.apiBase,
    system: args.system,
    range: args.range,
  })
  const [data, setData] = useState<HourOfWeekRow[] | null>(null)
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
    const sql = buildHourOfWeekQuery({ range: args.range, urls, timezone: args.timezone })
    conn.query(sql).then(
      result => {
        if (cancelled) return
        const rows = result.toArray().map((r: any) => ({
          dow: Number(r.dow),
          hod: Number(r.hod),
          avg_bikes: Number(r.avg_bikes),
          samples: Number(r.samples),
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
  }, [conn, keys, args.r2Base, args.range.fromTs, args.range.toTs, args.timezone])

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
