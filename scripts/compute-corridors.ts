/**
 * Per-system corridor derivation + cross-system index.
 *
 * For each system in systems.json: fetch the GBFS discovery doc, resolve the
 * station_information / system_information / system_regions sub-feeds, read an
 * optional committed override (corridors/<systemId>.json), run the shared
 * selectCorridors tiering, and write gbfs/<systemId>/corridors.json to R2.
 * Also emits gbfs/systems-index.json (one entry per system) for the picker
 * and the geo-aware /api/systems endpoint.
 *
 * Runs daily (corridors change rarely). Env: CF_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY, R2_BUCKET.
 */
import { readFileSync } from 'node:fs'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { fetchJsonWithRetry } from '../src/workers/lib/gbfs-client'
import { getSystems, type SystemConfig } from '../src/shared/systems'
import {
  selectCorridors,
  type CorridorOverride,
  type CorridorStation,
  type GbfsRegion,
} from '../src/shared/corridors'
import type { SystemIndexEntry } from '../src/shared/systems-index'

type Discovery = { data: { en: { feeds: Array<{ name: string; url: string }> } } }
type SysInfo = { system_id: string; name: string; timezone: string; language: string; url: string | null }

export function resolveFeeds(discovery: Discovery): Record<string, string> {
  return Object.fromEntries(discovery.data.en.feeds.map(f => [f.name, f.url]))
}

function validCoords(stations: CorridorStation[]): CorridorStation[] {
  return stations.filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon) && !(s.lat === 0 && s.lon === 0))
}

export function indexEntryFor(
  cfg: SystemConfig,
  sys: SysInfo,
  stations: CorridorStation[],
): SystemIndexEntry {
  const valid = validCoords(stations)
  const lats = valid.map(s => s.lat)
  const lons = valid.map(s => s.lon)
  const meanLon = lons.reduce((a, b) => a + b, 0) / (lons.length || 1)
  const meanLat = lats.reduce((a, b) => a + b, 0) / (lats.length || 1)
  return {
    systemId: cfg.system_id,
    name: cfg.name,
    gbfsUrl: cfg.gbfs_url,
    rentalUrl: sys.url ?? null,
    timezone: sys.timezone,
    centroid: [meanLon, meanLat],
    bbox: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
    stationCount: stations.length,
  }
}

function readOverride(systemId: string): CorridorOverride | null {
  try {
    return JSON.parse(readFileSync(`corridors/${systemId}.json`, 'utf8')) as CorridorOverride
  } catch {
    return null
  }
}

function normalizeStations(raw: any): CorridorStation[] {
  const arr = raw?.data?.stations
  if (!Array.isArray(arr)) throw new Error('station_information.data.stations missing')
  return arr.map((s: any) => ({
    station_id: String(s.station_id),
    name: String(s.name ?? ''),
    lat: Number(s.lat),
    lon: Number(s.lon),
    region_id: typeof s.region_id === 'string' ? s.region_id : undefined,
  }))
}

function normalizeRegions(raw: any): GbfsRegion[] {
  const arr = raw?.data?.regions
  if (!Array.isArray(arr)) return []
  return arr.map((r: any) => ({ region_id: String(r.region_id), region_name: String(r.region_name) }))
}

function normalizeSysInfo(raw: any): SysInfo {
  const d = raw?.data ?? {}
  return {
    system_id: String(d.system_id ?? ''),
    name: String(d.name ?? ''),
    timezone: String(d.timezone ?? 'UTC'),
    language: String(d.language ?? 'en'),
    url: typeof d.url === 'string' ? d.url : null,
  }
}

export async function processSystem(cfg: SystemConfig, now: number): Promise<{ entry: SystemIndexEntry; corridors: string }> {
  const discovery = await fetchJsonWithRetry<Discovery>(cfg.gbfs_url)
  const feeds = resolveFeeds(discovery)
  if (!feeds.station_information || !feeds.system_information) {
    throw new Error(`Missing required sub-feed for ${cfg.system_id}`)
  }
  const [siRaw, sysRaw, regionsRaw] = await Promise.all([
    fetchJsonWithRetry(feeds.station_information),
    fetchJsonWithRetry(feeds.system_information),
    feeds.system_regions ? fetchJsonWithRetry(feeds.system_regions).catch(() => null) : Promise.resolve(null),
  ])
  const stations = normalizeStations(siRaw)
  const sys = normalizeSysInfo(sysRaw)
  const regions = regionsRaw ? normalizeRegions(regionsRaw) : []
  const override = readOverride(cfg.system_id)

  const artifact = selectCorridors({ stations, regions, override, now })
  console.log(`${cfg.system_id}: source=${artifact.source} corridors=${artifact.corridors.length} assigned=${Object.keys(artifact.assignments).length}/${stations.length}`)
  return { entry: indexEntryFor(cfg, sys, stations), corridors: JSON.stringify(artifact) }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const accountId = process.env.CF_ACCOUNT_ID
    const accessKeyId = process.env.R2_ACCESS_KEY_ID
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
    const bucket = process.env.R2_BUCKET
    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
      throw new Error('Missing one of CF_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET')
    }
    const s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    })
    const now = Math.floor(Date.now() / 1000)
    const index: SystemIndexEntry[] = []

    for (const cfg of getSystems()) {
      try {
        const { entry, corridors } = await processSystem(cfg, now)
        await s3.send(new PutObjectCommand({
          Bucket: bucket,
          Key: `gbfs/${cfg.system_id}/corridors.json`,
          Body: corridors,
          ContentType: 'application/json',
          CacheControl: 'public, max-age=3600',
        }))
        index.push(entry)
        console.log(`wrote gbfs/${cfg.system_id}/corridors.json`)
      } catch (err) {
        console.error(`corridors failed for ${cfg.system_id}:`, err)
      }
    }

    if (index.length === 0) throw new Error('no systems processed; refusing to overwrite index')
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: 'gbfs/systems-index.json',
      Body: JSON.stringify({ generated_at: now, systems: index }),
      ContentType: 'application/json',
      CacheControl: 'public, max-age=3600',
    }))
    console.log(`wrote gbfs/systems-index.json (${index.length} systems)`)
  })().catch(err => { console.error('compute-corridors failed:', err); process.exit(1) })
}
