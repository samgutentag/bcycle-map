import { fetchJsonWithRetry } from './lib/gbfs-client'
import {
  normalizeStationInformation,
  normalizeStationStatus,
  normalizeSystemInformation,
  mergeSnapshot,
} from '../shared/normalize'
import type { KVValue } from '../shared/types'
import type { SystemConfig } from '../shared/systems'

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
