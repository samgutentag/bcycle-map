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

const DOW_FILTER_THRESHOLD_DAYS = 21
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function tsToLocalParts(ts: number, timezone: string): { dow: number; hour: number; dateKey: string } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    hour12: false,
  })
  const parts = fmt.formatToParts(new Date(ts * 1000))
  const weekday = parts.find(p => p.type === 'weekday')?.value ?? 'Sun'
  const year = parts.find(p => p.type === 'year')?.value ?? '1970'
  const month = parts.find(p => p.type === 'month')?.value ?? '01'
  const day = parts.find(p => p.type === 'day')?.value ?? '01'
  const hourStr = parts.find(p => p.type === 'hour')?.value ?? '0'
  const hour = Number(hourStr === '24' ? '0' : hourStr)
  const dow = WEEKDAYS.indexOf(weekday)
  return { dow: dow < 0 ? 0 : dow, hour, dateKey: `${year}-${month}-${day}` }
}

async function getSystemTimezone(env: Env, systemId: string): Promise<string> {
  const raw = await env.GBFS_KV.get(latestKey(systemId))
  if (!raw) return 'UTC'
  try {
    const obj = JSON.parse(raw)
    return obj?.system?.timezone || 'UTC'
  } catch {
    return 'UTC'
  }
}

async function handleStationTypical(env: Env, systemId: string, stationId: string): Promise<Response> {
  const nowTs = Math.floor(Date.now() / 1000)
  const timezone = await getSystemTimezone(env, systemId)

  // List all parquet partitions for this system
  const prefix = `gbfs/${systemId}/station_status/`
  const parquetKeys: string[] = []
  let cursor: string | undefined
  do {
    const result: any = await env.GBFS_R2.list({ prefix, cursor })
    for (const obj of result.objects) {
      if (partitionKeyToTs(obj.key) === null) continue
      parquetKeys.push(obj.key)
    }
    cursor = result.truncated ? result.cursor : undefined
  } while (cursor)
  parquetKeys.sort()

  // Read every partition for this station, plus uncompacted buffers
  const fromTs = 0
  const parquetSamples = (await Promise.all(
    parquetKeys.map(k => readStationFromParquet(env, k, stationId, fromTs)),
  )).flat()
  const bufferSamples = await readStationFromKvBuffers(env, systemId, stationId, fromTs, nowTs + 3600)

  const byTs = new Map<number, Sample>()
  for (const s of [...parquetSamples, ...bufferSamples]) byTs.set(s.snapshot_ts, s)
  const samples = [...byTs.values()]

  // Annotate every sample with local DOW + hour-of-day + date-key for coverage counting
  const annotated = samples.map(s => {
    const parts = tsToLocalParts(s.snapshot_ts, timezone)
    return { ...s, ...parts }
  })

  // Count distinct local dates of coverage to decide DOW-filter vs all-days fallback
  const distinctDates = new Set(annotated.map(a => a.dateKey))
  const daysCovered = distinctDates.size

  const todayParts = tsToLocalParts(nowTs, timezone)
  const isDowFiltered = daysCovered >= DOW_FILTER_THRESHOLD_DAYS
  const filtered = isDowFiltered
    ? annotated.filter(a => a.dow === todayParts.dow)
    : annotated

  // Aggregate to 24 hour-of-day buckets (avg across all matching samples)
  const accum = new Map<number, { bikes: number; docks: number; n: number }>()
  for (const a of filtered) {
    const cur = accum.get(a.hour) ?? { bikes: 0, docks: 0, n: 0 }
    cur.bikes += a.num_bikes_available
    cur.docks += a.num_docks_available
    cur.n += 1
    accum.set(a.hour, cur)
  }
  const hours = Array.from({ length: 24 }, (_, h) => {
    const cur = accum.get(h)
    if (!cur) return { hour: h, bikes: 0, docks: 0, samples: 0 }
    return {
      hour: h,
      bikes: Math.round((cur.bikes / cur.n) * 10) / 10,
      docks: Math.round((cur.docks / cur.n) * 10) / 10,
      samples: cur.n,
    }
  })

  const label = isDowFiltered
    ? `Typical ${WEEKDAY_FULL[todayParts.dow]}`
    : 'Typical (all days)'

  return new Response(
    JSON.stringify({
      stationId,
      hours,
      currentHour: todayParts.hour,
      currentDow: todayParts.dow,
      daysCovered,
      isDowFiltered,
      label,
      timezone,
    }),
    {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'content-type': 'application/json',
        'cache-control': 'max-age=300',
      },
    },
  )
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
      try {
        return await handleStationTypical(env, systemId, stationId)
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
