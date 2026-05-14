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
import type { KVNamespace, ScheduledEvent, ExecutionContext } from '@cloudflare/workers-types'
import type { Env } from '../../worker-configuration'
import {
  activityKey as activityKeyFor,
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

export async function writeSnapshotToKV(kv: KVNamespace, snap: KVValue): Promise<void> {
  const lKey = latestKey(snap.system.system_id)
  const aKey = activityKeyFor(snap.system.system_id)

  // Read previous snapshot to carry forward the running max of bikes-parked.
  // The "ever observed" max approximates total fleet size: at peak idle
  // (typically 3am) most bikes are parked at stations.
  const [prevRaw, activityRaw] = await Promise.all([kv.get(lKey), kv.get(aKey)])
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

  const enriched: KVValue = { ...snap, max_bikes_ever: maxBikesEver, recent24h: recent }

  // Activity log: diff per-station bike counts vs previous snapshot to emit
  // departure/arrival events, plus a naive trip pairing when the system
  // transitions cleanly through a single active rider (0→1 then 1→0).
  let nextActivity: ActivityLog | null = null
  if (prev) {
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

  await kv.put(lKey, JSON.stringify(enriched))
  if (nextActivity) await kv.put(aKey, JSON.stringify(nextActivity))

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
  await kv.put(bufKey, JSON.stringify(buffer))
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const systems = getSystems()
    for (const sys of systems) {
      try {
        const snap = await pollOnce(sys)
        await writeSnapshotToKV(env.GBFS_KV, snap)
      } catch (err) {
        console.error(`poll failed for ${sys.system_id}:`, err)
      }
    }
  },
}
