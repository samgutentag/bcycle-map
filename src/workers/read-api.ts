import type { Env } from '../../worker-configuration'
import { latestKey, currentBufferKey } from './poller'
import { parquetReadObjects } from 'hyparquet'
import type { BufferEntry } from '../shared/types'

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
}

const CURRENT_RE = /^\/api\/systems\/([^/]+)\/current$/
const PARTITIONS_RE = /^\/api\/systems\/([^/]+)\/partitions$/
const STATION_RECENT_RE = /^\/api\/systems\/([^/]+)\/stations\/([^/]+)\/recent$/

function partitionKeyToTs(key: string): number | null {
  const m = key.match(/dt=(\d{4})-(\d{2})-(\d{2})\/(\d{2})\.parquet$/)
  if (!m) return null
  const [, y, mo, d, h] = m
  return Math.floor(Date.UTC(+y!, +mo! - 1, +d!, +h!) / 1000)
}

async function handlePartitions(env: Env, systemId: string, fromTs: number, toTs: number): Promise<Response> {
  const prefix = `gbfs/${systemId}/station_status/`
  const keys: string[] = []
  let cursor: string | undefined
  do {
    const result: any = await env.GBFS_R2.list({ prefix, cursor })
    for (const obj of result.objects) {
      const ts = partitionKeyToTs(obj.key)
      if (ts === null) continue
      if (ts >= fromTs - 3600 && ts <= toTs + 3600) {
        keys.push(obj.key)
      }
    }
    cursor = result.truncated ? result.cursor : undefined
  } while (cursor)
  keys.sort()
  return new Response(JSON.stringify({ keys }), {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'content-type': 'application/json',
      'cache-control': 'max-age=60',
    },
  })
}

type Sample = { snapshot_ts: number; num_bikes_available: number; num_docks_available: number }

async function readStationFromParquet(env: Env, key: string, stationId: string, fromTs: number): Promise<Sample[]> {
  const obj = await env.GBFS_R2.get(key)
  if (!obj) return []
  const buf = await obj.arrayBuffer()
  // hyparquet wants an AsyncBuffer-like; ArrayBuffer works directly in recent versions.
  const rows = await parquetReadObjects({
    file: buf,
    columns: ['snapshot_ts', 'station_id', 'num_bikes_available', 'num_docks_available'],
  }) as Array<{ snapshot_ts: bigint | number; station_id: string; num_bikes_available: number; num_docks_available: number }>
  const out: Sample[] = []
  for (const r of rows) {
    if (r.station_id !== stationId) continue
    const ts = typeof r.snapshot_ts === 'bigint' ? Number(r.snapshot_ts) : r.snapshot_ts
    if (ts < fromTs) continue
    out.push({
      snapshot_ts: ts,
      num_bikes_available: Number(r.num_bikes_available),
      num_docks_available: Number(r.num_docks_available),
    })
  }
  return out
}

async function readStationFromKvBuffers(env: Env, systemId: string, stationId: string, fromTs: number, toTs: number): Promise<Sample[]> {
  // The intra-hour buffer holds samples that haven't been compacted to parquet yet.
  // Walk back hour-by-hour from now until we cover the requested range.
  const samples: Sample[] = []
  for (let ts = toTs; ts >= fromTs - 3600; ts -= 3600) {
    const key = currentBufferKey(systemId, ts)
    const raw = await env.GBFS_KV.get(key)
    if (!raw) continue
    const buffer: BufferEntry[] = JSON.parse(raw)
    for (const entry of buffer) {
      if (entry.snapshot_ts < fromTs || entry.snapshot_ts > toTs) continue
      const s = entry.stations.find(st => st.station_id === stationId)
      if (!s) continue
      samples.push({
        snapshot_ts: entry.snapshot_ts,
        num_bikes_available: s.num_bikes_available,
        num_docks_available: s.num_docks_available,
      })
    }
  }
  return samples
}

async function handleStationRecent(env: Env, systemId: string, stationId: string, hoursBack: number): Promise<Response> {
  const nowTs = Math.floor(Date.now() / 1000)
  const fromTs = nowTs - hoursBack * 3600

  // Find parquet partitions covering the range
  const prefix = `gbfs/${systemId}/station_status/`
  const parquetKeys: string[] = []
  let cursor: string | undefined
  do {
    const result: any = await env.GBFS_R2.list({ prefix, cursor })
    for (const obj of result.objects) {
      const ts = partitionKeyToTs(obj.key)
      if (ts === null) continue
      if (ts >= fromTs - 3600 && ts <= nowTs + 3600) {
        parquetKeys.push(obj.key)
      }
    }
    cursor = result.truncated ? result.cursor : undefined
  } while (cursor)
  parquetKeys.sort()

  // Read parquet rows for the station + KV buffer rows for any uncompacted hours
  const parquetSamples = (await Promise.all(
    parquetKeys.map(k => readStationFromParquet(env, k, stationId, fromTs)),
  )).flat()
  const bufferSamples = await readStationFromKvBuffers(env, systemId, stationId, fromTs, nowTs)

  // Dedupe by snapshot_ts (parquet + buffer may overlap if compaction just ran)
  const byTs = new Map<number, Sample>()
  for (const s of [...parquetSamples, ...bufferSamples]) byTs.set(s.snapshot_ts, s)
  const samples = [...byTs.values()].sort((a, b) => a.snapshot_ts - b.snapshot_ts)

  // Aggregate to 1h buckets (avg of samples falling in each hour)
  const bucketSec = 3600
  const accum = new Map<number, { bikes: number; docks: number; n: number }>()
  for (const s of samples) {
    const bucket = Math.floor(s.snapshot_ts / bucketSec) * bucketSec
    const cur = accum.get(bucket) ?? { bikes: 0, docks: 0, n: 0 }
    cur.bikes += s.num_bikes_available
    cur.docks += s.num_docks_available
    cur.n += 1
    accum.set(bucket, cur)
  }
  const buckets = [...accum.entries()]
    .sort(([a], [b]) => a - b)
    .map(([ts, { bikes, docks, n }]) => ({
      ts,
      bikes: Math.round((bikes / n) * 10) / 10,
      docks: Math.round((docks / n) * 10) / 10,
      samples: n,
    }))

  return new Response(JSON.stringify({ stationId, hoursBack, buckets }), {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'content-type': 'application/json',
      'cache-control': 'max-age=60',
    },
  })
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)

    const cur = url.pathname.match(CURRENT_RE)
    if (cur) {
      const systemId = cur[1]!
      const raw = await env.GBFS_KV.get(latestKey(systemId))
      if (!raw) return new Response('not found', { status: 404, headers: CORS_HEADERS })
      return new Response(raw, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'content-type': 'application/json',
          'cache-control': 'max-age=60',
        },
      })
    }

    const part = url.pathname.match(PARTITIONS_RE)
    if (part) {
      const systemId = part[1]!
      const fromTs = Number(url.searchParams.get('from') ?? '0')
      const toTs = Number(url.searchParams.get('to') ?? Math.floor(Date.now() / 1000).toString())
      return handlePartitions(env, systemId, fromTs, toTs)
    }

    const recent = url.pathname.match(STATION_RECENT_RE)
    if (recent) {
      const systemId = recent[1]!
      const stationId = recent[2]!
      const hours = Math.min(168, Math.max(1, Number(url.searchParams.get('hours') ?? '24')))
      try {
        return await handleStationRecent(env, systemId, stationId, hours)
      } catch (err) {
        return new Response(`error: ${err instanceof Error ? err.message : String(err)}`, {
          status: 500,
          headers: CORS_HEADERS,
        })
      }
    }

    return new Response('not found', { status: 404 })
  },
}
