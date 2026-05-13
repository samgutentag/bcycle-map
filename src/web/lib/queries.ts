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

/**
 * Enumerates one URL per UTC hour in the range, pointing at the expected
 * parquet path. R2's public dev URL doesn't expose LIST so we can't glob —
 * we enumerate explicit hour files and let DuckDB skip any that 404.
 */
export function partitionUrls(baseUrl: string, system: string, range: Range): string[] {
  const startHour = Math.floor(range.fromTs / 3600) * 3600
  const endHour = Math.floor(range.toTs / 3600) * 3600
  const urls: string[] = []
  for (let h = startHour; h <= endHour; h += 3600) {
    const d = new Date(h * 1000)
    const yyyy = d.getUTCFullYear()
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(d.getUTCDate()).padStart(2, '0')
    const hh = String(d.getUTCHours()).padStart(2, '0')
    urls.push(`${baseUrl}/gbfs/${system}/station_status/dt=${yyyy}-${mm}-${dd}/${hh}.parquet`)
  }
  return urls
}

function partitionList(urls: string[]): string {
  return `[${urls.map(u => `'${u}'`).join(', ')}]`
}

// `error_on_missing_files=false` tells DuckDB to skip 404s for HTTP-backed reads
// rather than failing the whole query. Without it, any single missing hour file
// (compactor hasn't run for that hour yet, current hour still buffering, etc.)
// would tank the query.
const READ_OPTS = 'union_by_name=true'

export function buildTotalBikesQuery(args: QueryArgs): string {
  const urls = partitionUrls(args.baseUrl, args.system, args.range)
  if (urls.length === 0) return `SELECT NULL::BIGINT as snapshot_ts, NULL::BIGINT as total_bikes WHERE FALSE`
  const src = partitionList(urls)
  return `
    SELECT snapshot_ts, SUM(num_bikes_available) as total_bikes
    FROM read_parquet(${src}, ${READ_OPTS})
    WHERE snapshot_ts BETWEEN ${args.range.fromTs} AND ${args.range.toTs}
    GROUP BY snapshot_ts
    ORDER BY snapshot_ts
  `.trim()
}

export function buildHourOfWeekQuery(args: QueryArgs): string {
  const urls = partitionUrls(args.baseUrl, args.system, args.range)
  if (urls.length === 0) return `SELECT NULL::INTEGER as dow, NULL::INTEGER as hod, NULL::DOUBLE as avg_bikes, NULL::BIGINT as samples WHERE FALSE`
  const src = partitionList(urls)
  return `
    SELECT
      date_part('dow', to_timestamp(snapshot_ts)) as dow,
      date_part('hour', to_timestamp(snapshot_ts)) as hod,
      AVG(num_bikes_available) as avg_bikes,
      COUNT(*) as samples
    FROM read_parquet(${src}, ${READ_OPTS})
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
  // Look at the current hour and the previous hour to be safe near hour boundaries.
  const urls: string[] = []
  for (let h = 0; h < 2; h++) {
    const t = args.atTs - h * 3600
    const d = new Date(t * 1000)
    const yyyy = d.getUTCFullYear()
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(d.getUTCDate()).padStart(2, '0')
    const hh = String(d.getUTCHours()).padStart(2, '0')
    urls.push(`${args.baseUrl}/gbfs/${args.system}/station_status/dt=${yyyy}-${mm}-${dd}/${hh}.parquet`)
  }
  const src = partitionList(urls)
  return `
    WITH partition_data AS (
      SELECT * FROM read_parquet(${src}, ${READ_OPTS})
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
