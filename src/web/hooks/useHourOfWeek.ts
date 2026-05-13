import { useEffect, useState } from 'react'
import { useDuckDB } from './useDuckDB'
import { usePartitionKeys } from './usePartitionKeys'
import { buildHourOfWeekQuery } from '../lib/queries'
import type { Range } from '../lib/date-range'

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
}

export function useHourOfWeek(args: Args) {
  const { conn, loading: dbLoading, error: dbError } = useDuckDB()
  const { keys, loading: partsLoading, error: partsError } = usePartitionKeys({
    apiBase: args.apiBase,
    system: args.system,
    range: args.range,
  })
  const [data, setData] = useState<HourOfWeekRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!conn || !keys) return
    let cancelled = false
    setLoading(true)
    const urls = keys.map(k => `${args.r2Base}/${k}`)
    const sql = buildHourOfWeekQuery({ range: args.range, urls })
    conn.query(sql).then(
      result => {
        if (cancelled) return
        const rows = result.toArray().map((r: any) => ({
          dow: Number(r.dow),
          hod: Number(r.hod),
          avg_bikes: Number(r.avg_bikes),
          samples: Number(r.samples),
        }))
        setData(rows)
        setLoading(false)
      },
      e => {
        if (cancelled) return
        setError(e as Error)
        setLoading(false)
      },
    )
    return () => {
      cancelled = true
    }
  }, [conn, keys, args.r2Base, args.range.fromTs, args.range.toTs])

  return {
    data,
    loading: dbLoading || partsLoading || loading,
    error: dbError || partsError || error,
  }
}
