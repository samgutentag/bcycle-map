import type { Env } from '../../worker-configuration'
import { latestKey } from './poller'

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

// Worker reads pre-computed typical profiles written by the
// compute-typicals GH Action. This keeps the request under the
// 10ms CPU budget by avoiding parquet parsing entirely.
async function handleStationTypical(env: Env, systemId: string, stationId: string): Promise<Response> {
  const nowTs = Math.floor(Date.now() / 1000)
  const timezone = await getSystemTimezone(env, systemId)
  const todayParts = tsToLocalParts(nowTs, timezone)

  const obj = await env.GBFS_R2.get(`gbfs/${systemId}/typicals/${stationId}.json`)
  // Build the empty 24-hour shape so the frontend can always render the chart
  const emptyHours = Array.from({ length: 24 }, (_, h) => ({ hour: h, bikes: 0, docks: 0, samples: 0 }))

  if (!obj) {
    return new Response(
      JSON.stringify({
        stationId,
        hours: emptyHours,
        currentHour: todayParts.hour,
        currentDow: todayParts.dow,
        daysCovered: 0,
        isDowFiltered: false,
        label: 'Typical (no history yet)',
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

  const text = await obj.text()
  const profile = JSON.parse(text) as {
    stationId: string
    computedAt: number
    daysCovered: number
    byDow: Array<Array<{ hour: number; bikes: number; docks: number; samples: number }>>
    allDays: Array<{ hour: number; bikes: number; docks: number; samples: number }>
  }

  const isDowFiltered = profile.daysCovered >= DOW_FILTER_THRESHOLD_DAYS
  const hours = isDowFiltered ? profile.byDow[todayParts.dow] ?? profile.allDays : profile.allDays
  const label = isDowFiltered
    ? `Typical ${WEEKDAY_FULL[todayParts.dow]}`
    : 'Typical (all days)'

  return new Response(
    JSON.stringify({
      stationId,
      hours,
      currentHour: todayParts.hour,
      currentDow: todayParts.dow,
      daysCovered: profile.daysCovered,
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
