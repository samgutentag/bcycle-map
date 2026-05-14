/**
 * Replays per-station bike-count deltas across the last N hours of
 * compacted parquet partitions to populate the activity log with
 * historical departures, arrivals, and inferred trips. Idempotent —
 * existing events/trips in KV are preserved and the new entries are
 * deduped against them.
 *
 * The same `detectEvents` + `applyTripTransition` helpers the live
 * poller uses are applied in chronological order against each
 * consecutive snapshot pair, so the output matches what the poller
 * would have written had it been running over those hours.
 */
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { parquetReadObjects } from 'hyparquet'
import type { ActivityEvent, ActivityLog, Trip } from '../src/shared/types'
import {
  activityKey,
  detectEvents,
  applyTripTransition,
  appendTick,
  emptyActivityLog,
} from '../src/shared/activity'

const DEFAULT_HOURS_BACK = 3

type ParquetRow = {
  snapshot_ts: bigint | number
  station_id: string
  num_bikes_available: number
}

type Snap = {
  ts: number
  stations: Array<{ station_id: string; num_bikes_available: number }>
}

export function partitionKeysForHoursBack(systemId: string, nowSec: number, hours: number): Array<{ hourTs: number; key: string }> {
  const currentHourTs = Math.floor(nowSec / 3600) * 3600
  const out: Array<{ hourTs: number; key: string }> = []
  for (let i = hours; i >= 1; i--) {
    const hourTs = currentHourTs - i * 3600
    const d = new Date(hourTs * 1000)
    const yyyy = d.getUTCFullYear()
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(d.getUTCDate()).padStart(2, '0')
    const hh = String(d.getUTCHours()).padStart(2, '0')
    out.push({ hourTs, key: `gbfs/${systemId}/station_status/dt=${yyyy}-${mm}-${dd}/${hh}.parquet` })
  }
  return out
}

export function snapshotsFromRows(rows: ParquetRow[]): Snap[] {
  const byTs = new Map<number, Snap['stations']>()
  for (const r of rows) {
    const ts = typeof r.snapshot_ts === 'bigint' ? Number(r.snapshot_ts) : r.snapshot_ts
    if (!byTs.has(ts)) byTs.set(ts, [])
    byTs.get(ts)!.push({ station_id: String(r.station_id), num_bikes_available: Number(r.num_bikes_available) })
  }
  return Array.from(byTs.entries()).sort(([a], [b]) => a - b).map(([ts, stations]) => ({ ts, stations }))
}

/**
 * Replay every consecutive snapshot pair through the same activity helpers
 * the live poller uses. Returns the synthesized activity log built up from
 * an empty starting state.
 */
export function replaySnapshots(snaps: Snap[], maxBikesEver: number): ActivityLog {
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
    log = appendTick(log, events, transition, { maxEvents: Number.POSITIVE_INFINITY, maxTrips: Number.POSITIVE_INFINITY })
  }
  return log
}

function eventKey(e: ActivityEvent): string {
  return `${e.ts}|${e.station_id}|${e.type}`
}

function tripKey(t: Trip): string {
  return `${t.departure_ts}|${t.arrival_ts}|${t.from_station_id}|${t.to_station_id}`
}

/**
 * Combine a backfill log with the existing live log, deduping on
 * (ts, station_id, type) for events and (dep_ts, arr_ts, from, to) for
 * trips. Existing entries win on dedupe so we never overwrite live data.
 */
export function mergeLogs(existing: ActivityLog, backfill: ActivityLog, caps: { maxEvents: number; maxTrips: number }): ActivityLog {
  const seenEvents = new Set(existing.events.map(eventKey))
  const newEvents = [...existing.events]
  for (const e of backfill.events) {
    if (!seenEvents.has(eventKey(e))) {
      newEvents.push(e)
      seenEvents.add(eventKey(e))
    }
  }
  newEvents.sort((a, b) => a.ts - b.ts)

  const seenTrips = new Set(existing.trips.map(tripKey))
  const newTrips = [...existing.trips]
  for (const t of backfill.trips) {
    if (!seenTrips.has(tripKey(t))) {
      newTrips.push(t)
      seenTrips.add(tripKey(t))
    }
  }
  newTrips.sort((a, b) => a.departure_ts - b.departure_ts)

  return {
    events: newEvents.slice(-caps.maxEvents),
    trips: newTrips.slice(-caps.maxTrips),
    inFlightFromStationId: existing.inFlightFromStationId ?? null,
    inFlightDepartureTs: existing.inFlightDepartureTs ?? null,
  }
}

type KVClient = {
  get(key: string): Promise<string | null>
  put(key: string, body: string): Promise<void>
}

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
    put: async (key, body) => {
      const res = await fetch(`${base}/values/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { ...headers, 'content-type': 'application/octet-stream' },
        body,
      })
      if (!res.ok) throw new Error(`KV put ${res.status}: ${await res.text()}`)
    },
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = process.env
  for (const k of [
    'CF_ACCOUNT_ID',
    'CF_KV_API_TOKEN',
    'CF_KV_NAMESPACE_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET',
    'SYSTEM_ID',
  ]) {
    if (!env[k]) throw new Error(`missing env ${k}`)
  }

  ;(async () => {
    const systemId = env.SYSTEM_ID!
    const hoursBack = Number(env.HOURS_BACK ?? DEFAULT_HOURS_BACK)
    const nowSec = Math.floor(Date.now() / 1000)

    const s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${env.CF_ACCOUNT_ID!}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY! },
    })
    const kv = makeKVClient({
      accountId: env.CF_ACCOUNT_ID!,
      namespaceId: env.CF_KV_NAMESPACE_ID!,
      token: env.CF_KV_API_TOKEN!,
    })

    // Read current max_bikes_ever from the latest KV value so the trip-pairing
    // active-rider math uses our best fleet-size estimate for historical data.
    const latestKey = `system:${systemId}:latest`
    const latestRaw = await kv.get(latestKey)
    if (!latestRaw) throw new Error(`KV ${latestKey} not found`)
    const latest = JSON.parse(latestRaw) as { max_bikes_ever?: number }
    const maxBikesEver = latest.max_bikes_ever ?? 0
    if (maxBikesEver === 0) {
      console.warn('max_bikes_ever is 0 — trip pairing will identify nothing')
    }
    console.log(`Using max_bikes_ever=${maxBikesEver} for active-rider math.`)

    console.log(`Backfilling ${hoursBack}h of activity for ${systemId} (now=${new Date(nowSec * 1000).toISOString()})`)
    const partitions = partitionKeysForHoursBack(systemId, nowSec, hoursBack)

    // Load every partition's rows into one big chronological snapshot list.
    const allSnaps: Snap[] = []
    for (const { key } of partitions) {
      try {
        const got = await s3.send(new GetObjectCommand({ Bucket: env.R2_BUCKET!, Key: key }))
        const ab = await got.Body!.transformToByteArray()
        const rows = await parquetReadObjects({
          file: ab.buffer as ArrayBuffer,
          columns: ['snapshot_ts', 'station_id', 'num_bikes_available'],
        }) as ParquetRow[]
        const snaps = snapshotsFromRows(rows)
        console.log(`  ${key}: ${rows.length} rows, ${snaps.length} snapshots`)
        allSnaps.push(...snaps)
      } catch (e: any) {
        if (e?.Code === 'NoSuchKey' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) {
          console.log(`  ${key}: not compacted, skipping`)
          continue
        }
        throw e
      }
    }
    allSnaps.sort((a, b) => a.ts - b.ts)
    console.log(`Total snapshots loaded: ${allSnaps.length}`)

    if (allSnaps.length < 2) {
      console.log('Not enough snapshots to compute deltas; nothing to backfill.')
      return
    }

    const backfilled = replaySnapshots(allSnaps, maxBikesEver)
    console.log(`Synthesized ${backfilled.events.length} events and ${backfilled.trips.length} trips from history.`)

    const aKey = activityKey(systemId)
    const existingRaw = await kv.get(aKey)
    const existing: ActivityLog = existingRaw ? JSON.parse(existingRaw) : emptyActivityLog()
    console.log(`Existing live log: ${existing.events.length} events, ${existing.trips.length} trips.`)

    const merged = mergeLogs(existing, backfilled, { maxEvents: 200, maxTrips: 50 })
    console.log(`Merged total: ${merged.events.length} events, ${merged.trips.length} trips (capped to 200/50).`)

    await kv.put(aKey, JSON.stringify(merged))
    console.log(`Wrote merged activity log back to ${aKey}.`)
  })().catch(err => {
    console.error('backfill-activity failed:', err)
    process.exit(1)
  })
}
