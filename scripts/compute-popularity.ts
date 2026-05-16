import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { parquetToSnapshots, type SnapshotRow } from '../src/shared/parquet'
import { inferTrips, type SimpleMatrix } from '../src/shared/trip-inference'
import type { ActivityEvent, Trip } from '../src/shared/types'
import type { Popularity, PairStat } from '../src/shared/popularity'

const WINDOW_DAYS = 30
const TOP_N = 10

type Env = {
  CF_ACCOUNT_ID?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
  R2_BUCKET?: string
  SYSTEM_ID?: string
}

function requireEnv(env: Env, key: keyof Env): string {
  const v = env[key]
  if (!v) throw new Error(`Missing env var: ${key}`)
  return v
}

function partitionKeyToTs(key: string): number | null {
  const m = key.match(/dt=(\d{4})-(\d{2})-(\d{2})\/(\d{2})\.parquet$/)
  if (!m) return null
  const [, y, mo, d, h] = m
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h)) / 1000
}

async function listPartitionsInWindow(
  s3: S3Client,
  bucket: string,
  systemId: string,
  fromTs: number,
  toTs: number,
): Promise<string[]> {
  const prefix = `gbfs/${systemId}/station_status/`
  const keys: string[] = []
  let token: string | undefined
  do {
    const result = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: token,
    }))
    for (const obj of result.Contents ?? []) {
      const key = obj.Key
      if (!key) continue
      const ts = partitionKeyToTs(key)
      if (ts === null) continue
      if (ts >= fromTs - 3600 && ts <= toTs + 3600) keys.push(key)
    }
    token = result.IsTruncated ? result.NextContinuationToken : undefined
  } while (token)
  return keys.sort()
}

async function fetchTravelMatrix(s3: S3Client, bucket: string, systemId: string): Promise<SimpleMatrix> {
  const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: `gbfs/${systemId}/travel-times.json` }))
  const text = await r.Body!.transformToString()
  const json = JSON.parse(text) as { edges: SimpleMatrix }
  return json.edges
}

async function readPartition(s3: S3Client, bucket: string, key: string): Promise<SnapshotRow[]> {
  const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  const buf = new Uint8Array(await r.Body!.transformToByteArray())
  return parquetToSnapshots(buf)
}

function synthesizeEvents(rows: SnapshotRow[]): ActivityEvent[] {
  const byStation = new Map<string, SnapshotRow[]>()
  for (const row of rows) {
    const id = row.station.station_id
    if (!byStation.has(id)) byStation.set(id, [])
    byStation.get(id)!.push(row)
  }
  const events: ActivityEvent[] = []
  for (const list of byStation.values()) {
    list.sort((a, b) => a.snapshot_ts - b.snapshot_ts)
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1]!
      const curr = list[i]!
      const delta = curr.station.num_bikes_available - prev.station.num_bikes_available
      if (delta === 0) continue
      if (delta < 0) {
        events.push({ ts: curr.snapshot_ts, station_id: curr.station.station_id, type: 'departure', delta: -delta })
      } else {
        events.push({ ts: curr.snapshot_ts, station_id: curr.station.station_id, type: 'arrival', delta })
      }
    }
  }
  events.sort((a, b) => a.ts - b.ts)
  return events
}

type StationCounts = { departures: number; arrivals: number }

function aggregate(events: ActivityEvent[], trips: Trip[]): {
  stationCounts: Map<string, StationCounts>
  pairAgg: Map<string, Map<string, { count: number; durationSum: number }>>
} {
  const stationCounts = new Map<string, StationCounts>()
  for (const e of events) {
    let row = stationCounts.get(e.station_id)
    if (!row) { row = { departures: 0, arrivals: 0 }; stationCounts.set(e.station_id, row) }
    if (e.type === 'departure') row.departures += e.delta
    else row.arrivals += e.delta
  }
  const pairAgg = new Map<string, Map<string, { count: number; durationSum: number }>>()
  for (const t of trips) {
    let row = pairAgg.get(t.from_station_id)
    if (!row) { row = new Map(); pairAgg.set(t.from_station_id, row) }
    let cell = row.get(t.to_station_id)
    if (!cell) { cell = { count: 0, durationSum: 0 }; row.set(t.to_station_id, cell) }
    cell.count++
    cell.durationSum += t.duration_sec
  }
  return { stationCounts, pairAgg }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const env = process.env as Env
    const systemId = requireEnv(env, 'SYSTEM_ID')
    const bucket = requireEnv(env, 'R2_BUCKET')
    const accountId = requireEnv(env, 'CF_ACCOUNT_ID')
    const accessKeyId = requireEnv(env, 'R2_ACCESS_KEY_ID')
    const secretAccessKey = requireEnv(env, 'R2_SECRET_ACCESS_KEY')

    const s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    })

    const nowTs = Math.floor(Date.now() / 1000)
    const fromTs = nowTs - WINDOW_DAYS * 86400

    console.log(`window: ${WINDOW_DAYS}d, ${new Date(fromTs * 1000).toISOString()} → ${new Date(nowTs * 1000).toISOString()}`)

    const matrix = await fetchTravelMatrix(s3, bucket, systemId)
    console.log(`travel matrix loaded: ${Object.keys(matrix).length} origins`)

    const keys = await listPartitionsInWindow(s3, bucket, systemId, fromTs, nowTs)
    console.log(`partitions in window: ${keys.length}`)
    if (keys.length === 0) throw new Error('no partitions found in window; refusing to overwrite')

    const allRows: SnapshotRow[] = []
    let read = 0
    for (const key of keys) {
      try {
        const rows = await readPartition(s3, bucket, key)
        allRows.push(...rows)
      } catch (e: unknown) {
        console.warn(`skipped ${key}:`, e instanceof Error ? e.message : e)
      }
      read++
      if (read % 25 === 0) console.log(`  read ${read}/${keys.length}`)
    }
    console.log(`total rows: ${allRows.length}`)

    const events = synthesizeEvents(allRows)
    console.log(`synthesized events: ${events.length}`)
    if (events.length === 0) throw new Error('zero events after parsing; refusing to overwrite')

    const trips = inferTrips(events, matrix, [])
    console.log(`inferred trips: ${trips.length}`)

    const { stationCounts, pairAgg } = aggregate(events, trips)

    const topStations = [...stationCounts.entries()]
      .map(([station_id, { departures, arrivals }]) => ({
        station_id,
        departures,
        arrivals,
        count: departures + arrivals,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, TOP_N)

    const flatPairs: Array<{ from_station_id: string; to_station_id: string; count: number }> = []
    const pairStats: Record<string, Record<string, PairStat>> = {}
    for (const [from, row] of pairAgg) {
      pairStats[from] = {}
      for (const [to, { count, durationSum }] of row) {
        pairStats[from][to] = { count, mean_sec: Math.round(durationSum / count) }
        flatPairs.push({ from_station_id: from, to_station_id: to, count })
      }
    }
    const topRoutes = flatPairs.sort((a, b) => b.count - a.count).slice(0, TOP_N)

    const popularity: Popularity = {
      computedAt: nowTs,
      windowStartTs: fromTs,
      windowEndTs: nowTs,
      topStations,
      topRoutes,
      pairStats,
    }

    const key = `gbfs/${systemId}/popularity.json`
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(popularity),
      ContentType: 'application/json',
      CacheControl: 'public, max-age=300',
    }))
    console.log(`wrote ${key}: ${topStations.length} stations, ${topRoutes.length} routes, ${flatPairs.length} pair stats`)
  })().catch(err => {
    console.error('compute-popularity failed:', err)
    process.exit(1)
  })
}
