import { useEffect, useState } from 'react'
import { useDuckDB } from './useDuckDB'
import { buildTotalBikesQuery } from '../lib/queries'
import type { Range } from '../lib/date-range'

export type TotalBikesRow = {
  snapshot_ts: number
  total_bikes: number
  total_docks: number
}

type Args = { baseUrl: string; system: string; range: Range }

export function useTotalBikesOverTime(args: Args) {
  const { conn, loading: dbLoading, error: dbError } = useDuckDB()
  const [data, setData] = useState<TotalBikesRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!conn) return
    let cancelled = false
    setLoading(true)
    const sql = buildTotalBikesQuery(args)
    conn.query(sql).then(
      result => {
        if (cancelled) return
        const rows = result.toArray().map((r: any) => ({
          snapshot_ts: Number(r.snapshot_ts),
          total_bikes: Number(r.total_bikes),
          total_docks: Number(r.total_docks),
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
  }, [conn, args.baseUrl, args.system, args.range.fromTs, args.range.toTs])

  return { data, loading: dbLoading || loading, error: dbError || error }
}
