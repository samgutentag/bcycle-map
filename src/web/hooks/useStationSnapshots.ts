import { useEffect, useState } from 'react'
import { useDuckDB } from './useDuckDB'
import { buildStationSnapshotsQuery } from '../lib/queries'

export type StationSnapshotRow = {
  station_id: string
  name: string
  lat: number
  lon: number
  num_bikes_available: number
  num_docks_available: number
  snapshot_ts: number
}

type Args = { baseUrl: string; system: string; atTs: number }

export function useStationSnapshots(args: Args) {
  const { conn, loading: dbLoading, error: dbError } = useDuckDB()
  const [data, setData] = useState<StationSnapshotRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!conn) return
    let cancelled = false
    setLoading(true)
    const sql = buildStationSnapshotsQuery(args)
    conn.query(sql).then(
      result => {
        if (cancelled) return
        const rows = result.toArray().map((r: any) => ({
          station_id: String(r.station_id),
          name: String(r.name),
          lat: Number(r.lat),
          lon: Number(r.lon),
          num_bikes_available: Number(r.num_bikes_available),
          num_docks_available: Number(r.num_docks_available),
          snapshot_ts: Number(r.snapshot_ts),
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
  }, [conn, args.baseUrl, args.system, args.atTs])

  return { data, loading: dbLoading || loading, error: dbError || error }
}
