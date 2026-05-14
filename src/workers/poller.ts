import { fetchJsonWithRetry } from './lib/gbfs-client'
import {
  normalizeStationInformation,
  normalizeStationStatus,
  normalizeSystemInformation,
  mergeSnapshot,
} from '../shared/normalize'
import { getSystems } from '../shared/systems'
import type { KVValue, BufferEntry, ActivityLog } from '../shared/types'
import type { SystemConfig } from '../shared/systems'
import type { KVNamespace, R2Bucket, ScheduledEvent, ExecutionContext } from '@cloudflare/workers-types'
import type { Env } from '../../worker-configuration'
import {
  activityR2Key,
  appendTick,
  applyTripTransition,
  detectEvents,
  emptyActivityLog,
} from '../shared/activity'

type PollDeps = {
  fetchImpl?: typeof fetch
  now?: () => number
}

type Discovery = {
  data: { en: { feeds: Array<{ name: string; url: string }> } }
}

export async function pollOnce(
  system: SystemConfig,
  deps: PollDeps = {}
): Promise<KVValue> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000))

  const discovery = await fetchJsonWithRetry<Discovery>(system.gbfs_url, { fetchImpl })
  const feeds = Object.fromEntries(
    discovery.data.en.feeds.map(f => [f.name, f.url])
  )

  if (!feeds.station_information || !feeds.station_status || !feeds.system_information) {
    throw new Error(`Missing required sub-feed for ${system.system_id}`)
  }

  const [statics, dyns, sysInfo] = await Promise.all([
    fetchJsonWithRetry(feeds.station_information, { fetchImpl }).then(
      normalizeStationInformation as (f: unknown) => ReturnType<typeof normalizeStationInformation>
    ),
    fetchJsonWithRetry(feeds.station_status, { fetchImpl }).then(
      normalizeStationStatus as (f: unknown) => ReturnType<typeof normalizeStationStatus>
    ),
    fetchJsonWithRetry(feeds.system_information, { fetchImpl }).then(
      normalizeSystemInformation as (f: unknown) => ReturnType<typeof normalizeSystemInformation>
    ),
  ])

  return {
    system: sysInfo,
    snapshot_ts: now(),
    stations: mergeSnapshot(statics, dyns),
  }
}

export function currentBufferKey(systemId: string, snapshotTs: number): string {
  const d = new Date(snapshotTs * 1000)
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  return `system:${systemId}:buffer:${yyyy}-${mm}-${dd}-${hh}`
}

export function latestKey(systemId: string): string {
  return `system:${systemId}:latest`
}

export async function writeSnapshotToKV(kv: KVNamespace, r2: R2Bucket, snap: KVValue): Promise<void> {
  const lKey = latestKey(snap.system.system_id)
  const aKey = activityR2Key(snap.system.system_id)

  // Read previous snapshot from KV and the activity log from R2 (moved off
  // KV to avoid the 1000/day free-tier put cap). Run in parallel; the R2
  // GET returns an object whose body we read as text for the JSON parse +
  // byte-comparison below.
  const [prevRaw, activityObj] = await Promise.all([kv.get(lKey), r2.get(aKey)])
  const activityRaw: string | null = activityObj ? await activityObj.text() : null
  const prev: KVValue | null = prevRaw ? JSON.parse(prevRaw) : null
  const totalBikesNow = snap.stations.reduce((sum, s) => sum + s.num_bikes_available, 0)
  const totalBikesPrev = prev ? prev.stations.reduce((sum, s) => sum + s.num_bikes_available, 0) : totalBikesNow
  const maxBikesEver = Math.max(prev?.max_bikes_ever ?? 0, totalBikesNow)

  // Maintain a 24-hour rolling window of per-hour bikes-available min/max
  // so the live stats card can draw trend sparklines without a side fetch.
  const hourTs = Math.floor(snap.snapshot_ts / 3600) * 3600
  const cutoff = snap.snapshot_ts - 24 * 3600
  const recent: KVValue['recent24h'] = (prev?.recent24h ?? []).filter(h => h.hour_ts >= cutoff)
  const existingIdx = recent.findIndex(h => h.hour_ts === hourTs)
  if (existingIdx >= 0) {
    const cur = recent[existingIdx]!
    recent[existingIdx] = {
      hour_ts: cur.hour_ts,
      bikes_max: Math.max(cur.bikes_max, totalBikesNow),
      bikes_min: Math.min(cur.bikes_min, totalBikesNow),
    }
  } else {
    recent.push({ hour_ts: hourTs, bikes_max: totalBikesNow, bikes_min: totalBikesNow })
  }
  recent.sort((a, b) => a.hour_ts - b.hour_ts)

  // Track "last time the system-wide bike count changed" so the UI can show
  // a "changed Xm ago" badge. Carry forward the prior value when this tick's
  // total matches the previous tick's total.
  const lastTotalChangedTs = prev
    ? (totalBikesNow !== totalBikesPrev ? snap.snapshot_ts : (prev.last_total_changed_ts ?? snap.snapshot_ts))
    : snap.snapshot_ts

  const enriched: KVValue = {
    ...snap,
    max_bikes_ever: maxBikesEver,
    recent24h: recent,
    last_total_changed_ts: lastTotalChangedTs,
  }

  // Activity log: diff per-station bike counts vs previous snapshot to emit
  // departure/arrival events, plus a naive trip pairing when the system
  // transitions cleanly through a single active rider (0→1 then 1→0).
  //
  // Freshness guard: if prev.snapshot_ts is older than a couple ticks (e.g.
  // KV writes have been failing under the daily put cap, leaving `:latest`
  // frozen), skip activity detection. Otherwise we'd diff a multi-hour gap
  // and stamp the resulting events at this tick's time — data rot.
  const STALE_PREV_THRESHOLD_SEC = 10 * 60
  const prevAgeSec = prev ? snap.snapshot_ts - prev.snapshot_ts : 0
  const prevIsFresh = prev && prevAgeSec <= STALE_PREV_THRESHOLD_SEC
  let nextActivity: ActivityLog | null = null
  if (prev && !prevIsFresh) {
    console.warn(`prev snapshot is ${prevAgeSec}s old (>${STALE_PREV_THRESHOLD_SEC}s); skipping activity diff this tick`)
  }
  if (prevIsFresh) {
    let activity: ActivityLog = emptyActivityLog()
    if (activityRaw) {
      try {
        activity = JSON.parse(activityRaw)
      } catch (e) {
        console.error(`activity parse failed for ${snap.system.system_id}, starting fresh:`, e)
      }
    }
    const events = detectEvents(prev.stations, snap.stations, snap.snapshot_ts)
    const prevActive = Math.max(0, maxBikesEver - totalBikesPrev)
    const currActive = Math.max(0, maxBikesEver - totalBikesNow)
    const transition = applyTripTransition(activity, events, snap.snapshot_ts, prevActive, currActive)
    nextActivity = appendTick(activity, events, transition)
  }

  const bufKey = currentBufferKey(snap.system.system_id, snap.snapshot_ts)
  const existing = await kv.get(bufKey)
  const buffer: BufferEntry[] = existing ? JSON.parse(existing) : []
  buffer.push({
    snapshot_ts: snap.snapshot_ts,
    stations: snap.stations.map(s => ({
      station_id: s.station_id,
      num_bikes_available: s.num_bikes_available,
      num_docks_available: s.num_docks_available,
      bikes_electric: s.bikes_electric,
      bikes_classic: s.bikes_classic,
      bikes_smart: s.bikes_smart,
      is_installed: s.is_installed,
      is_renting: s.is_renting,
      is_returning: s.is_returning,
      last_reported: s.last_reported,
    })),
  })

  // Each of the three writes is wrapped in its own try/catch so a failure
  // in one (e.g. KV daily-put cap exhausted) doesn't kill the others. The
  // R2 activity put goes first because it's the highest-value artifact and
  // R2 doesn't share KV's daily write quota.
  if (nextActivity) {
    const nextActivityJson = JSON.stringify(nextActivity)
    // Skip the activity put when this tick produced nothing new — byte-
    // compare the serialized form against what we already read from R2.
    if (nextActivityJson !== activityRaw) {
      try {
        await r2.put(aKey, nextActivityJson, { httpMetadata: { contentType: 'application/json' } })
      } catch (err) {
        console.error(`R2 activity put failed for ${snap.system.system_id}:`, err)
      }
    }
  }

  try {
    await kv.put(lKey, JSON.stringify(enriched))
  } catch (err) {
    console.error(`KV latest put failed for ${snap.system.system_id}:`, err)
  }

  try {
    await kv.put(bufKey, JSON.stringify(buffer))
  } catch (err) {
    console.error(`KV buffer put failed for ${snap.system.system_id} (${bufKey}):`, err)
  }
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const systems = getSystems()
    for (const sys of systems) {
      try {
        const snap = await pollOnce(sys)
        await writeSnapshotToKV(env.GBFS_KV, env.GBFS_R2, snap)
      } catch (err) {
        console.error(`poll failed for ${sys.system_id}:`, err)
      }
    }
  },
}
