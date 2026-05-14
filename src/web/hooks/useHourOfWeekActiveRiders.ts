import { useEffect, useState } from 'react'
import { useDuckDB } from './useDuckDB'
import { usePartitionKeys } from './usePartitionKeys'
import { buildHourOfWeekSystemBikesQuery } from '../lib/queries'
import type { Range } from '../lib/date-range'
import type { LoadPhase } from './useTotalBikesOverTime'

export type ActiveRidersHourRow = {
  dow: number
  hod: number
  avg_active_riders: number
  samples: number
}

type Args = {
  apiBase: string
  r2Base: string
  system: string
  range: Range
  timezone?: string
  /** Subtracted from observed total bikes to derive active riders. */
  maxBikesEver: number | undefined
}

const cache = new Map<string, ActiveRidersHourRow[]>()

function cacheKey(args: Args, keys: string[]): string {
  return `${args.r2Base}|${args.system}|${args.range.fromTs}|${args.range.toTs}|${args.timezone ?? 'UTC'}|${args.maxBikesEver ?? 0}|${keys.join(',')}`
}

export function useHourOfWeekActiveRiders(args: Args) {
  const { conn, loading: dbLoading, error: dbError } = useDuckDB()
  const { keys, loading: partsLoading, error: partsError } = usePartitionKeys({
    apiBase: args.apiBase,
    system: args.system,
    range: args.range,
  })
  const [data, setData] = useState<ActiveRidersHourRow[] | null>(null)
  const [queryLoading, setQueryLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!conn || !keys || !args.maxBikesEver) return
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
    const sql = buildHourOfWeekSystemBikesQuery({ range: args.range, urls, timezone: args.timezone })
    conn.query(sql).then(
      result => {
        if (cancelled) return
        const max = args.maxBikesEver!
        const rows: ActiveRidersHourRow[] = result.toArray().map((r: any) => ({
          dow: Number(r.dow),
          hod: Number(r.hod),
          avg_active_riders: Math.max(0, max - Number(r.avg_total_bikes)),
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
  }, [conn, keys, args.r2Base, args.range.fromTs, args.range.toTs, args.timezone, args.maxBikesEver])

  const phase: LoadPhase = !args.maxBikesEver
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
    loading: !!args.maxBikesEver && (dbLoading || partsLoading || queryLoading),
    phase,
    error: dbError || partsError || error,
    enabled: !!args.maxBikesEver,
  }
}
