import type { Range } from './date-range'

export type QueryArgs = {
  baseUrl: string
  system: string
  range: Range
}

/**
 * Returns an array of UTC date strings (YYYY-MM-DD) covering every day
 * in the [fromTs, toTs] range, inclusive on both ends.
 */
export function daysCovered(fromTs: number, toTs: number): string[] {
  const fromDay = Math.floor(fromTs / 86400) * 86400
  const toDay = Math.floor(toTs / 86400) * 86400
  const days: string[] = []
  for (let day = fromDay; day <= toDay; day += 86400) {
    const d = new Date(day * 1000)
    const yyyy = d.getUTCFullYear()
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(d.getUTCDate()).padStart(2, '0')
    days.push(`${yyyy}-${mm}-${dd}`)
  }
  return days
}

function partitionGlob(baseUrl: string, system: string, range: Range): string {
  const days = daysCovered(range.fromTs, range.toTs)
  if (days.length === 1) {
    return `'${baseUrl}/gbfs/${system}/station_status/dt=${days[0]}/*.parquet'`
  }
  const paths = days.map(d => `'${baseUrl}/gbfs/${system}/station_status/dt=${d}/*.parquet'`).join(', ')
  return `[${paths}]`
}

export function buildTotalBikesQuery(args: QueryArgs): string {
  const src = partitionGlob(args.baseUrl, args.system, args.range)
  return `
    SELECT snapshot_ts, SUM(num_bikes_available) as total_bikes
    FROM read_parquet(${src})
    WHERE snapshot_ts BETWEEN ${args.range.fromTs} AND ${args.range.toTs}
    GROUP BY snapshot_ts
    ORDER BY snapshot_ts
  `.trim()
}

export function buildHourOfWeekQuery(args: QueryArgs): string {
  const src = partitionGlob(args.baseUrl, args.system, args.range)
  return `
    SELECT
      date_part('dow', to_timestamp(snapshot_ts)) as dow,
      date_part('hour', to_timestamp(snapshot_ts)) as hod,
      AVG(num_bikes_available) as avg_bikes,
      COUNT(*) as samples
    FROM read_parquet(${src})
    WHERE snapshot_ts BETWEEN ${args.range.fromTs} AND ${args.range.toTs}
    GROUP BY dow, hod
    ORDER BY dow, hod
  `.trim()
}

export function buildStationSnapshotsQuery(args: {
  baseUrl: string
  system: string
  atTs: number
}): string {
  const d = new Date(args.atTs * 1000)
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const date = `${yyyy}-${mm}-${dd}`
  return `
    WITH partition_data AS (
      SELECT * FROM read_parquet('${args.baseUrl}/gbfs/${args.system}/station_status/dt=${date}/*.parquet')
      WHERE snapshot_ts <= ${args.atTs}
    ),
    latest AS (
      SELECT MAX(snapshot_ts) as ts FROM partition_data
    )
    SELECT station_id, name, lat, lon, num_bikes_available, num_docks_available, snapshot_ts
    FROM partition_data, latest
    WHERE partition_data.snapshot_ts = latest.ts
    ORDER BY station_id
  `.trim()
}
