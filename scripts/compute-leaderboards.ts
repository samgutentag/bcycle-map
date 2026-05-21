/**
 * Daily leaderboards rollup — reads the full station_status parquet
 * archive in R2, replays it through the same trip-inference primitives
 * the live poller uses, and emits gbfs/{systemId}/leaderboards.json with
 * top-20 station + route leaderboards for two windows: 30-day rolling
 * and all-time.
 *
 * Coexists with compute-popularity.ts:
 *   - popularity.json  → average-trip-duration badge on /route + station-pair
 *     stats on /station/:id/details (cares about pairStats map, 30d only)
 *   - leaderboards.json → /explore Popular Stations + Popular Routes tiles
 *     with 30d / All tab toggle (cares about top-N rankings only)
 *
 * Why two files? The pair-stat map blows up on all-time data (O(stations²)
 * pairs across thousands of partitions), but the leaderboards only need
 * the top-20 — keeping the rollups separate lets all-time stay sub-100KB.
 *
 * Cron schedule: daily. The rollup is a strict superset of yesterday's,
 * so per-hour writes would be wasted KV/R2 ops for a tile users won't
 * refresh that often. Daily keeps R2 ops < 30/month per system.
 */
import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { parquetReadObjects } from 'hyparquet'
import type { Trip } from '../src/shared/types'
import {
  detectEvents,
  applyTripTransition,
  appendTick,
  emptyActivityLog,
} from '../src/shared/activity'
import {
  type Leaderboards,
  type LeaderboardWindow,
  ROUTE_MIN_TRIPS,
  LEADERBOARD_TOP_N,
} from '../src/shared/leaderboards'

const WINDOW_DAYS_30D = 30

type Env = {
  CF_ACCOUNT_ID?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
  R2_BUCKET?: string
  SYSTEM_ID?: string
  /** Optional: pin max_bikes_ever for repeatable runs. Defaults to KV read. */
  MAX_BIKES_EVER?: string
  /** Optional: skip partitions older than this; mostly for local debugging. */
  MAX_PARTITIONS?: string
}

type ParquetRow = {
  snapshot_ts: bigint | number
  station_id: string
  num_bikes_available: number
}

type Snap = {
  ts: number
  stations: Array<{ station_id: string; num_bikes_available: number }>
}

type Event = { ts: number; station_id: string; type: 'departure' | 'arrival'; delta: number }

function requireEnv(env: Env, key: keyof Env): string {
  const v = env[key]
  if (!v) throw new Error(`Missing env var: ${key}`)
  return v
}

export function partitionKeyToTs(key: string): number | null {
  const m = key.match(/dt=(\d{4})-(\d{2})-(\d{2})\/(\d{2})\.parquet$/)
  if (!m) return null
  const [, y, mo, d, h] = m
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h)) / 1000
}

export function snapshotsFromRows(rows: ParquetRow[]): Snap[] {
  const byTs = new Map<number, Snap['stations']>()
  for (const r of rows) {
    const ts = typeof r.snapshot_ts === 'bigint' ? Number(r.snapshot_ts) : r.snapshot_ts
    if (!byTs.has(ts)) byTs.set(ts, [])
    byTs.get(ts)!.push({
      station_id: String(r.station_id),
      num_bikes_available: Number(r.num_bikes_available),
    })
  }
  return Array.from(byTs.entries()).sort(([a], [b]) => a - b).map(([ts, stations]) => ({ ts, stations }))
}

/**
 * Replay snapshots through the poller primitives and produce (events,
 * trips) so the leaderboard aggregator can score stations by per-event
 * delta and pair-count routes by inferred trips. Identical math to
 * scripts/backfill-activity.ts replaySnapshots, but we keep both halves
 * of the result instead of just the activity log.
 */
export function eventsAndTrips(snaps: Snap[], maxBikesEver: number): { events: Event[]; trips: Trip[] } {
  let log = emptyActivityLog()
  for (let i = 1; i < snaps.length; i++) {
    const prev = snaps[i - 1]!
    const curr = snaps[i]!
    const events = detectEvents(prev.stations, curr.stations, curr.ts)
    const totalPrev = prev.stations.reduce((s, x) => s + x.num_bikes_available, 0)
    const totalCurr = curr.stations.reduce((s, x) => s + x.num_bikes_available, 0)
    const prevActive = Math.max(0, maxBikesEver - totalPrev)
    const currActive = Math.max(0, maxBikesEver - totalCurr)
    const transition = applyTripTransition(log, events, curr.ts, prevActive, currActive)
    log = appendTick(log, events, transition, {
      maxEvents: Number.POSITIVE_INFINITY,
      maxTrips: Number.POSITIVE_INFINITY,
    })
  }
  return { events: log.events as Event[], trips: log.trips }
}

/**
 * Per-window aggregation: filter the full event/trip lists by timestamp,
 * accumulate per-station departures+arrivals, count directed station
 * pairs from trips, apply the ROUTE_MIN_TRIPS floor, sort, slice to the
 * top N. Both windows share the same input lists, so this runs cheaply
 * twice with different `sinceTs` cutoffs.
 */
export function buildLeaderboardWindow(
  events: Event[],
  trips: Trip[],
  sinceTs: number,
): LeaderboardWindow {
  const stationAgg = new Map<string, { departures: number; arrivals: number }>()
  for (const e of events) {
    if (e.ts < sinceTs) continue
    let row = stationAgg.get(e.station_id)
    if (!row) {
      row = { departures: 0, arrivals: 0 }
      stationAgg.set(e.station_id, row)
    }
    if (e.type === 'departure') row.departures += e.delta
    else row.arrivals += e.delta
  }

  const stations = Array.from(stationAgg.entries())
    .map(([station_id, { departures, arrivals }]) => ({
      station_id,
      departures,
      arrivals,
      total: departures + arrivals,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, LEADERBOARD_TOP_N)

  const pairAgg = new Map<string, number>()
  for (const t of trips) {
    if (t.departure_ts < sinceTs) continue
    const key = `${t.from_station_id}|${t.to_station_id}`
    pairAgg.set(key, (pairAgg.get(key) ?? 0) + 1)
  }

  const routes = Array.from(pairAgg.entries())
    .filter(([, trips]) => trips >= ROUTE_MIN_TRIPS)
    .map(([key, trips]) => {
      const [from, to] = key.split('|')
      return { from: from!, to: to!, trips }
    })
    .sort((a, b) => b.trips - a.trips)
    .slice(0, LEADERBOARD_TOP_N)

  return { stations, routes }
}

async function listAllPartitions(s3: S3Client, bucket: string, systemId: string): Promise<string[]> {
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
      if (partitionKeyToTs(key) === null) continue
      keys.push(key)
    }
    token = result.IsTruncated ? result.NextContinuationToken : undefined
  } while (token)
  return keys.sort()
}

async function readPartition(s3: S3Client, bucket: string, key: string): Promise<Snap[]> {
  const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  const ab = await r.Body!.transformToByteArray()
  const rows = (await parquetReadObjects({
    file: ab.buffer as ArrayBuffer,
    columns: ['snapshot_ts', 'station_id', 'num_bikes_available'],
  })) as ParquetRow[]
  return snapshotsFromRows(rows)
}

type KVClient = { get(key: string): Promise<string | null> }

function makeKVClient(opts: { accountId: string; namespaceId: string; token: string }): KVClient {
  const base = `https://api.cloudflare.com/client/v4/accounts/${opts.accountId}/storage/kv/namespaces/${opts.namespaceId}`
  const headers = { authorization: `Bearer ${opts.token}` }
  return {
    get: async (key) => {
      const res = await fetch(`${base}/values/${encodeURIComponent(key)}`, { headers })
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`KV get ${res.status}`)
      return await res.text()
    },
  }
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

    let maxBikesEver = Number(env.MAX_BIKES_EVER ?? 0)
    if (!maxBikesEver) {
      const kvToken = process.env.CF_KV_API_TOKEN
      const kvNs = process.env.CF_KV_NAMESPACE_ID
      if (kvToken && kvNs) {
        const kv = makeKVClient({ accountId, namespaceId: kvNs, token: kvToken })
        const raw = await kv.get(`system:${systemId}:latest`)
        if (raw) {
          const parsed = JSON.parse(raw) as { max_bikes_ever?: number }
          maxBikesEver = parsed.max_bikes_ever ?? 0
        }
      }
    }
    if (!maxBikesEver) {
      console.warn('max_bikes_ever unknown — trip pairing will identify nothing; routes window will be empty')
    } else {
      console.log(`Using max_bikes_ever=${maxBikesEver} for active-rider math.`)
    }

    const nowTs = Math.floor(Date.now() / 1000)
    const sinceTs30d = nowTs - WINDOW_DAYS_30D * 86400

    const allKeys = await listAllPartitions(s3, bucket, systemId)
    console.log(`partitions in archive: ${allKeys.length}`)
    if (allKeys.length === 0) throw new Error('no partitions found; refusing to overwrite')

    const cap = env.MAX_PARTITIONS ? Number(env.MAX_PARTITIONS) : allKeys.length
    const keys = allKeys.slice(-cap)
    console.log(`reading ${keys.length} partitions${cap < allKeys.length ? ` (capped from ${allKeys.length})` : ''}`)

    const allSnaps: Snap[] = []
    let read = 0
    for (const key of keys) {
      try {
        const snaps = await readPartition(s3, bucket, key)
        allSnaps.push(...snaps)
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        console.warn(`skipped ${key}: ${msg}`)
      }
      read++
      if (read % 50 === 0) console.log(`  read ${read}/${keys.length}`)
    }
    allSnaps.sort((a, b) => a.ts - b.ts)
    console.log(`total snapshots: ${allSnaps.length}`)

    if (allSnaps.length < 2) {
      throw new Error('not enough snapshots to compute leaderboards; refusing to overwrite')
    }

    const { events, trips } = eventsAndTrips(allSnaps, maxBikesEver)
    console.log(`derived ${events.length} events, ${trips.length} trips`)

    const windows30d = buildLeaderboardWindow(events, trips, sinceTs30d)
    const windowsAll = buildLeaderboardWindow(events, trips, 0)
    console.log(
      `30d: ${windows30d.stations.length} stations, ${windows30d.routes.length} routes / ` +
      `all: ${windowsAll.stations.length} stations, ${windowsAll.routes.length} routes`,
    )

    const out: Leaderboards = {
      generated_at: nowTs,
      windows: { '30d': windows30d, all: windowsAll },
    }
    const body = JSON.stringify(out)
    console.log(`rollup size: ${body.length} bytes`)

    const key = `gbfs/${systemId}/leaderboards.json`
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'application/json',
      CacheControl: 'public, max-age=300',
    }))
    console.log(`wrote ${key}`)
  })().catch(err => {
    console.error('compute-leaderboards failed:', err)
    process.exit(1)
  })
}
