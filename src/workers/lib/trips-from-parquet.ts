/**
 * Worker-side trip derivation: same flow as scripts/backfill-activity.ts
 * (the production source of historical trips), but executed against the
 * R2 binding inside the read-api worker so /flow can ask for trips outside
 * the rolling 50-trip activity log.
 *
 * Why re-derive instead of storing trips as their own parquet? The poller
 * only persists 50 trips in a rolling activity log and station_status
 * partitions are the canonical archive — so the snapshot partitions ARE
 * the trip archive, just one level of inference away. We use the same
 * detectEvents/applyTripTransition primitives the poller uses so a trip
 * computed here matches a trip the poller would have committed.
 */
import { parquetReadObjects } from 'hyparquet'
import type { Trip } from '../../shared/types'
import {
  detectEvents,
  applyTripTransition,
  appendTick,
  emptyActivityLog,
} from '../../shared/activity'
import { inferTrips, type SimpleMatrix } from '../../shared/trip-inference'

type ParquetRow = {
  snapshot_ts: bigint | number
  station_id: string
  num_bikes_available: number
}

type ParquetRowWithDocks = ParquetRow & {
  num_docks_available: number
}

export type Snap = {
  ts: number
  stations: Array<{ station_id: string; num_bikes_available: number }>
}

/**
 * Snapshot variant that also carries `num_docks_available`. Used by the
 * /flow historical pin rewind (#52) — pin counts at the scrubbed cursor
 * need both sides of the bike/dock ratio, whereas trip pairing only
 * cares about bikes.
 */
export type SnapWithDocks = {
  ts: number
  stations: Array<{
    station_id: string
    num_bikes_available: number
    num_docks_available: number
  }>
}

/**
 * Hourly partition keys covering [sinceTs, untilTs]. Both bounds are
 * inclusive at the hour granularity — a partition is included if any
 * of its hour overlaps the requested window. We pad by one hour on
 * each side so trips that span a partition boundary are still pairable.
 */
export function partitionKeysForRange(systemId: string, sinceTs: number, untilTs: number): string[] {
  const startHour = Math.floor((sinceTs - 3600) / 3600) * 3600
  const endHour = Math.floor((untilTs + 3600) / 3600) * 3600
  const out: string[] = []
  for (let hourTs = startHour; hourTs <= endHour; hourTs += 3600) {
    const d = new Date(hourTs * 1000)
    const yyyy = d.getUTCFullYear()
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(d.getUTCDate()).padStart(2, '0')
    const hh = String(d.getUTCHours()).padStart(2, '0')
    out.push(`gbfs/${systemId}/station_status/dt=${yyyy}-${mm}-${dd}/${hh}.parquet`)
  }
  return out
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
 * Replay consecutive snapshot pairs through the same poller primitives that
 * write the live activity log, then return inferred trips. Active rider
 * count is derived from maxBikesEver - sum(bikes_available); when
 * maxBikesEver is 0 (cold start) trip pairing identifies nothing.
 *
 * Runs the same two-pass replay as the live poller (#75): first the
 * conservative `applyTripTransition` for clean 0→1→0 single-rider
 * transitions (confidence='high'), then the greedy `inferTrips` over
 * every event the conservative pass collected, scored against the
 * travel-time matrix (confidence='low'). Most production trips come
 * from the greedy path — without it the bulk endpoint returns ~0 trips
 * during normal-volume hours.
 *
 * `matrix` is the on-disk `travel-times.json` shape's `.edges` field
 * (Record<from, Record<to, {minutes, meters}>>). When null, only the
 * conservative trips are returned — the same degraded-mode behavior the
 * poller uses when travel-times.json is missing.
 */
export function tripsFromSnapshots(
  snaps: Snap[],
  maxBikesEver: number,
  matrix: SimpleMatrix | null,
): Trip[] {
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
  // Greedy pass: feed every accumulated event through inferTrips with the
  // conservative-paired trips as `existingTrips` so those slots stay off
  // limits. Mirrors the poller's `nextActivity.events` + `nextActivity.trips`
  // call in src/workers/poller.ts. Without a matrix we can't score
  // candidates, so we just return the conservative output.
  if (!matrix || log.events.length === 0) return log.trips
  const greedy = inferTrips(log.events, matrix, log.trips)
  return [...log.trips, ...greedy].sort((a, b) => a.departure_ts - b.departure_ts)
}

/**
 * R2-bound reader: fetch each partition, parse with hyparquet, accumulate
 * snapshots. Missing partitions (NoSuchKey) are silently skipped — gaps in
 * the archive shouldn't fail the whole window. Any other read error bubbles.
 */
export type R2Like = {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>
}

export async function readSnapshotsForRange(
  r2: R2Like,
  systemId: string,
  sinceTs: number,
  untilTs: number,
): Promise<Snap[]> {
  const keys = partitionKeysForRange(systemId, sinceTs, untilTs)
  const allSnaps: Snap[] = []
  for (const key of keys) {
    const obj = await r2.get(key)
    if (!obj) continue
    const buf = await obj.arrayBuffer()
    const rows = (await parquetReadObjects({
      file: buf,
      columns: ['snapshot_ts', 'station_id', 'num_bikes_available'],
    })) as ParquetRow[]
    allSnaps.push(...snapshotsFromRows(rows))
  }
  allSnaps.sort((a, b) => a.ts - b.ts)
  return allSnaps
}

/**
 * Group parquet rows that include both bike + dock counts by snapshot_ts.
 * Mirrors `snapshotsFromRows` but preserves the dock column so the
 * /flow pin rewind can show both sides of the ratio at the scrubbed
 * timestamp.
 */
export function snapshotsWithDocksFromRows(rows: ParquetRowWithDocks[]): SnapWithDocks[] {
  const byTs = new Map<number, SnapWithDocks['stations']>()
  for (const r of rows) {
    const ts = typeof r.snapshot_ts === 'bigint' ? Number(r.snapshot_ts) : r.snapshot_ts
    if (!byTs.has(ts)) byTs.set(ts, [])
    byTs.get(ts)!.push({
      station_id: String(r.station_id),
      num_bikes_available: Number(r.num_bikes_available),
      num_docks_available: Number(r.num_docks_available),
    })
  }
  return Array.from(byTs.entries()).sort(([a], [b]) => a - b).map(([ts, stations]) => ({ ts, stations }))
}

/**
 * Downsample by keeping only snapshots whose ts is at least `stepSec` past
 * the previously-kept snapshot. The first and last snapshot are always kept
 * so the downsampled window still bookends the requested range.
 */
export function downsampleSnapshots<T extends { ts: number }>(snaps: T[], stepSec: number): T[] {
  if (snaps.length === 0) return snaps
  if (stepSec <= 0) return snaps
  const out: T[] = [snaps[0]!]
  let lastKept = snaps[0]!.ts
  for (let i = 1; i < snaps.length - 1; i++) {
    const s = snaps[i]!
    if (s.ts - lastKept >= stepSec) {
      out.push(s)
      lastKept = s.ts
    }
  }
  if (snaps.length > 1) {
    const last = snaps[snaps.length - 1]!
    if (out[out.length - 1] !== last) out.push(last)
  }
  return out
}

/**
 * R2-bound reader variant for the /flow pin-rewind endpoint. Same partition
 * walk + missing-key tolerance as `readSnapshotsForRange`, but pulls the
 * `num_docks_available` column too. Kept separate from the trip-pairing
 * reader so we don't pay the dock-column cost on every trips request.
 */
export async function readDockSnapshotsForRange(
  r2: R2Like,
  systemId: string,
  sinceTs: number,
  untilTs: number,
): Promise<SnapWithDocks[]> {
  const keys = partitionKeysForRange(systemId, sinceTs, untilTs)
  const allSnaps: SnapWithDocks[] = []
  for (const key of keys) {
    const obj = await r2.get(key)
    if (!obj) continue
    const buf = await obj.arrayBuffer()
    const rows = (await parquetReadObjects({
      file: buf,
      columns: ['snapshot_ts', 'station_id', 'num_bikes_available', 'num_docks_available'],
    })) as ParquetRowWithDocks[]
    allSnaps.push(...snapshotsWithDocksFromRows(rows))
  }
  allSnaps.sort((a, b) => a.ts - b.ts)
  return allSnaps
}
