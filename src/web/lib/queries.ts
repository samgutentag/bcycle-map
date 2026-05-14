import type { Range } from './date-range'

export type QueryArgs = {
  range: Range
  urls: string[]   // explicit list of parquet URLs known to exist
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

function partitionList(urls: string[]): string {
  return `[${urls.map(u => `'${u}'`).join(', ')}]`
}

const READ_OPTS = 'union_by_name=true'

/**
 * Wrap a read_parquet() source in a per-(snapshot_ts, station_id) dedupe.
 * Parquet partitions can occasionally contain duplicate rows for the same
 * snapshot+station — e.g. when a poll cycle gets retried mid-write, or when
 * two worker invocations overlap during a deploy — which would otherwise
 * inflate any SUM by the duplication factor. Picking MAX(value) per
 * (snapshot_ts, station_id) collapses duplicates to one row deterministically
 * (the values are identical for true duplicates, so MAX vs MIN vs ANY_VALUE
 * are equivalent).
 */
function dedupedSource(urls: string[], rangeFilter?: { fromTs: number; toTs: number }): string {
  const src = partitionList(urls)
  const where = rangeFilter
    ? `WHERE snapshot_ts BETWEEN ${rangeFilter.fromTs} AND ${rangeFilter.toTs}`
    : ''
  return `(
    SELECT
      snapshot_ts,
      station_id,
      ANY_VALUE(name) as name,
      ANY_VALUE(lat) as lat,
      ANY_VALUE(lon) as lon,
      MAX(num_bikes_available) as num_bikes_available,
      MAX(num_docks_available) as num_docks_available
    FROM read_parquet(${src}, ${READ_OPTS})
    ${where}
    GROUP BY snapshot_ts, station_id
  )`
}

// Defensive validation — timezones come from the GBFS feed and are
// interpolated into SQL strings. Only allow IANA-ish names to prevent
// any chance of injection if a feed publishes a malicious value.
function safeTimezone(tz: string | undefined): string {
  if (!tz) return 'UTC'
  return /^[A-Za-z][A-Za-z0-9_+/-]*$/.test(tz) ? tz : 'UTC'
}

export function buildTotalBikesQuery(args: QueryArgs): string {
  if (args.urls.length === 0) {
    return `SELECT NULL::BIGINT as snapshot_ts, NULL::BIGINT as total_bikes, NULL::BIGINT as total_docks WHERE FALSE`
  }
  return `
    SELECT
      snapshot_ts,
      SUM(num_bikes_available) as total_bikes,
      SUM(num_docks_available) as total_docks
    FROM ${dedupedSource(args.urls, args.range)} d
    GROUP BY snapshot_ts
    ORDER BY snapshot_ts
  `.trim()
}

export function buildHourOfWeekQuery(args: QueryArgs & { timezone?: string }): string {
  if (args.urls.length === 0) {
    return `SELECT NULL::INTEGER as dow, NULL::INTEGER as hod, NULL::DOUBLE as avg_bikes, NULL::BIGINT as samples WHERE FALSE`
  }
  const tz = safeTimezone(args.timezone)
  // Convert UTC snapshots into the system's local time so dow/hod buckets
  // reflect what "Tuesday 9am" means to a rider in that city.
  return `
    SELECT
      date_part('dow', to_timestamp(snapshot_ts) AT TIME ZONE '${tz}') as dow,
      date_part('hour', to_timestamp(snapshot_ts) AT TIME ZONE '${tz}') as hod,
      AVG(num_bikes_available) as avg_bikes,
      COUNT(*) as samples
    FROM ${dedupedSource(args.urls, args.range)} d
    GROUP BY dow, hod
    ORDER BY dow, hod
  `.trim()
}

/**
 * System-wide total bikes per snapshot, averaged into (dow, hour) cells.
 * The frontend computes active riders by subtracting from max_bikes_ever.
 */
export function buildHourOfWeekSystemBikesQuery(args: QueryArgs & { timezone?: string }): string {
  if (args.urls.length === 0) {
    return `SELECT NULL::INTEGER as dow, NULL::INTEGER as hod, NULL::DOUBLE as avg_total_bikes, NULL::BIGINT as samples WHERE FALSE`
  }
  const src = partitionList(args.urls)
  const tz = safeTimezone(args.timezone)
  return `
    WITH per_snapshot AS (
      SELECT snapshot_ts, SUM(num_bikes_available) as total_bikes
      FROM ${dedupedSource(args.urls, args.range)} d
      GROUP BY snapshot_ts
    )
    SELECT
      date_part('dow', to_timestamp(snapshot_ts) AT TIME ZONE '${tz}') as dow,
      date_part('hour', to_timestamp(snapshot_ts) AT TIME ZONE '${tz}') as hod,
      AVG(total_bikes) as avg_total_bikes,
      COUNT(*) as samples
    FROM per_snapshot
    GROUP BY dow, hod
    ORDER BY dow, hod
  `.trim()
}

export function buildStationOverTimeQuery(args: QueryArgs & { stationId: string }): string {
  if (args.urls.length === 0) {
    return `SELECT NULL::BIGINT as snapshot_ts, NULL::BIGINT as bikes, NULL::BIGINT as docks WHERE FALSE`
  }
  // Escape single quotes in station_id (defensive — IDs are publisher-controlled)
  const safeStationId = args.stationId.replace(/'/g, "''")
  return `
    SELECT snapshot_ts, num_bikes_available as bikes, num_docks_available as docks
    FROM ${dedupedSource(args.urls, args.range)} d
    WHERE station_id = '${safeStationId}'
    ORDER BY snapshot_ts
  `.trim()
}

export function buildStationSnapshotsQuery(args: {
  urls: string[]
  atTs: number
}): string {
  if (args.urls.length === 0) {
    return `SELECT NULL::VARCHAR as station_id, NULL::VARCHAR as name, NULL::DOUBLE as lat, NULL::DOUBLE as lon, NULL::BIGINT as num_bikes_available, NULL::BIGINT as num_docks_available, NULL::BIGINT as snapshot_ts WHERE FALSE`
  }
  return `
    WITH partition_data AS (
      SELECT * FROM ${dedupedSource(args.urls)} d
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
