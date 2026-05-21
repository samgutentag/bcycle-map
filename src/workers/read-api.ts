import type { Env } from '../../worker-configuration'
import { latestKey } from './poller'
import { activityKey, activityR2Key } from '../shared/activity'
import {
  readSnapshotsForRange,
  readDockSnapshotsForRange,
  downsampleSnapshots,
  tripsFromSnapshots,
} from './lib/trips-from-parquet'
import type { Trip } from '../shared/types'
import type { SimpleMatrix } from '../shared/trip-inference'

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
}

const CURRENT_RE = /^\/api\/systems\/([^/]+)\/current$/
const PARTITIONS_RE = /^\/api\/systems\/([^/]+)\/partitions$/
const STATION_RECENT_RE = /^\/api\/systems\/([^/]+)\/stations\/([^/]+)\/recent$/
const ACTIVITY_RE = /^\/api\/systems\/([^/]+)\/activity$/
const TRIPS_RE = /^\/api\/systems\/([^/]+)\/trips$/
const SNAPSHOTS_RE = /^\/api\/systems\/([^/]+)\/snapshots$/
const BEACON_RE = /^\/api\/beacon$/
const INSIGHTS_RE = /^\/api\/insights$/
const GEOCODE_RE = /^\/api\/geocode$/

const ANALYTICS_KEY_PREFIX = 'analytics/'
const ANALYTICS_RETENTION_DAYS = 90

function analyticsKey(dateStr: string): string {
  return `${ANALYTICS_KEY_PREFIX}${dateStr}.json`
}

function utcDateStr(tsSec: number): string {
  return new Date(tsSec * 1000).toISOString().slice(0, 10)
}

type BeaconEvent = {
  ts: number
  path: string
  referrer: string | null
  country: string | null
  session: string | null
  viewport: string | null  // "WxH" or null
}

async function handleBeacon(req: Request, env: Env): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { ...CORS_HEADERS, 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' },
    })
  }
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405, headers: CORS_HEADERS })
  }
  let body: any
  try {
    body = await req.json()
  } catch {
    return new Response('invalid json', { status: 400, headers: CORS_HEADERS })
  }
  if (typeof body?.path !== 'string' || body.path.length === 0 || body.path.length > 200) {
    return new Response('invalid path', { status: 400, headers: CORS_HEADERS })
  }
  const ts = Math.floor(Date.now() / 1000)
  const cf = (req as any).cf || {}
  const event: BeaconEvent = {
    ts,
    path: body.path,
    referrer: typeof body.referrer === 'string' && body.referrer.length <= 500 ? body.referrer : null,
    country: typeof cf.country === 'string' ? cf.country : null,
    session: typeof body.session === 'string' && body.session.length <= 64 ? body.session : null,
    viewport: typeof body.viewport === 'string' && body.viewport.length <= 16 ? body.viewport : null,
  }
  const key = analyticsKey(utcDateStr(ts))
  try {
    const existing = await env.GBFS_R2.get(key)
    const day: { date: string; events: BeaconEvent[] } = existing
      ? JSON.parse(await existing.text())
      : { date: utcDateStr(ts), events: [] }
    day.events.push(event)
    await env.GBFS_R2.put(key, JSON.stringify(day), { httpMetadata: { contentType: 'application/json' } })
  } catch (err) {
    console.error('beacon write failed:', err)
    // Don't fail the response — the user's nav shouldn't degrade if analytics writes fail
  }
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

async function handleInsights(url: URL, env: Env): Promise<Response> {
  const days = Math.min(ANALYTICS_RETENTION_DAYS, Math.max(1, Number(url.searchParams.get('days') ?? '30')))
  const nowSec = Math.floor(Date.now() / 1000)
  const allEvents: BeaconEvent[] = []
  for (let i = 0; i < days; i++) {
    const dateStr = utcDateStr(nowSec - i * 86400)
    try {
      const obj = await env.GBFS_R2.get(analyticsKey(dateStr))
      if (!obj) continue
      const day = JSON.parse(await obj.text()) as { events: BeaconEvent[] }
      allEvents.push(...day.events)
    } catch (err) {
      console.error(`insights: failed to read ${dateStr}:`, err)
    }
  }
  allEvents.sort((a, b) => a.ts - b.ts)
  return new Response(JSON.stringify({ events: allEvents, days }), {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'content-type': 'application/json',
      'cache-control': 'max-age=60',
    },
  })
}

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

// ─── Geocoding proxy ──────────────────────────────────────────────────
//
// The NearbyStationsSheet falls back to an address input when browser
// geolocation is denied or unavailable (issue #47). We proxy the typed
// query through this worker so the same GOOGLE_MAPS_API_KEY that powers
// the travel-times pipeline (scripts/compute-travel-times.ts) stays
// server-side — the web bundle never sees it.
//
// Successful response: { lat, lng, formatted }
// Error response: { error: 'ZERO_RESULTS' | 'OVER_QUOTA' | 'INVALID' }
//
// Quota note: the same key powers the gated travel-times pipeline, so the
// client-side debounce (~400ms, in-flight cancellation) is load-bearing.

type GeocodeOk = { lat: number; lng: number; formatted: string }
type GeocodeErr = { error: 'ZERO_RESULTS' | 'OVER_QUOTA' | 'INVALID' }

async function handleGeocode(url: URL, env: Env): Promise<Response> {
  const q = (url.searchParams.get('q') ?? '').trim()
  if (q.length === 0 || q.length > 200) {
    return jsonResponse<GeocodeErr>({ error: 'INVALID' }, 400)
  }
  if (!env.GOOGLE_MAPS_API_KEY) {
    // Misconfiguration: surface as a generic invalid error rather than 500
    // so the client UI degrades to the existing "manual retry" copy.
    return jsonResponse<GeocodeErr>({ error: 'INVALID' }, 500)
  }

  const apiUrl = new URL('https://maps.googleapis.com/maps/api/geocode/json')
  apiUrl.searchParams.set('address', q)
  apiUrl.searchParams.set('key', env.GOOGLE_MAPS_API_KEY)

  let upstream: Response
  try {
    upstream = await fetch(apiUrl.toString())
  } catch (err) {
    console.error('geocode upstream fetch failed:', err)
    return jsonResponse<GeocodeErr>({ error: 'INVALID' }, 502)
  }

  if (!upstream.ok) {
    return jsonResponse<GeocodeErr>({ error: 'INVALID' }, 502)
  }

  let body: any
  try {
    body = await upstream.json()
  } catch {
    return jsonResponse<GeocodeErr>({ error: 'INVALID' }, 502)
  }

  const status: string = body?.status ?? 'UNKNOWN_ERROR'
  if (status === 'ZERO_RESULTS') {
    return jsonResponse<GeocodeErr>({ error: 'ZERO_RESULTS' }, 200)
  }
  if (status === 'OVER_QUERY_LIMIT' || status === 'OVER_DAILY_LIMIT') {
    return jsonResponse<GeocodeErr>({ error: 'OVER_QUOTA' }, 429)
  }
  if (status !== 'OK') {
    return jsonResponse<GeocodeErr>({ error: 'INVALID' }, 502)
  }

  const first = Array.isArray(body.results) ? body.results[0] : null
  const loc = first?.geometry?.location
  if (!first || typeof loc?.lat !== 'number' || typeof loc?.lng !== 'number') {
    return jsonResponse<GeocodeErr>({ error: 'INVALID' }, 502)
  }

  const ok: GeocodeOk = {
    lat: loc.lat,
    lng: loc.lng,
    formatted: typeof first.formatted_address === 'string' ? first.formatted_address : q,
  }
  return jsonResponse(ok, 200, 'max-age=300')
}

// ─── Bulk trips endpoint (#53) ────────────────────────────────────────
//
// /flow's default window is 24h, which the rolling activity log usually
// covers — but only "usually". On a busy day the 50-trip cap can leave
// the last few hours; on a 7d window (a spec'd follow-up) it covers
// nowhere near enough. This endpoint re-derives trips from the snapshot
// parquet archive over an arbitrary [since, until] window so the hook
// can transparently fall back to it whenever the activity-log path
// isn't enough.
//
// Trips are stored implicitly: the canonical archive is the same
// station_status partitions used by /partitions, replayed through the
// poller's detectEvents/applyTripTransition primitives. That's why
// readSnapshotsForRange + tripsFromSnapshots mirror what
// scripts/backfill-activity.ts does for KV backfills.

const TRIPS_MAX_WINDOW_SEC = 7 * 86400

type TripsResponse = { trips: Trip[]; since: number; until: number }
type TripsError = { error: string }

async function handleTrips(env: Env, systemId: string, sinceTs: number, untilTs: number): Promise<Response> {
  if (!Number.isFinite(sinceTs) || !Number.isFinite(untilTs)) {
    return jsonResponse<TripsError>({ error: 'since and until must be unix-second integers' }, 400)
  }
  if (untilTs <= sinceTs) {
    return jsonResponse<TripsError>({ error: 'until must be greater than since' }, 400)
  }
  if (untilTs - sinceTs > TRIPS_MAX_WINDOW_SEC) {
    return jsonResponse<TripsError>({ error: `window must be <= ${TRIPS_MAX_WINDOW_SEC} seconds (7 days)` }, 400)
  }

  // Trip pairing needs maxBikesEver to compute active-rider counts.
  // Same value the live poller maintains in the KV `latest` blob.
  const latestRaw = await env.GBFS_KV.get(latestKey(systemId))
  let maxBikesEver = 0
  if (latestRaw) {
    try {
      const obj = JSON.parse(latestRaw)
      if (typeof obj?.max_bikes_ever === 'number') maxBikesEver = obj.max_bikes_ever
    } catch {
      // tolerate a malformed KV blob — pairing will identify nothing,
      // which is the same behavior as a fresh system before the poller
      // has seen a full fleet.
    }
  }

  // Greedy trip inference (#75) needs the travel-time matrix so it can
  // score departure→arrival pairings against expected durations. Without
  // it we'd fall back to conservative-only trips, which on a normal day
  // is ~0 trips for SB — the bug PR #74 hit when /flow tried to use
  // this endpoint as its default source. The matrix file is large but
  // immutable until the station set changes; the response-level
  // max-age=60 cache fronts most repeat loads.
  let matrix: SimpleMatrix | null = null
  try {
    const matrixObj = await env.GBFS_R2.get(`gbfs/${systemId}/travel-times.json`)
    if (matrixObj) {
      const parsed = JSON.parse(await matrixObj.text()) as { edges?: SimpleMatrix }
      if (parsed?.edges) matrix = parsed.edges
      else console.warn(`trips: travel-times.json for ${systemId} missing 'edges' field; greedy inference disabled`)
    } else {
      console.warn(`trips: travel-times.json missing for ${systemId}; returning conservative trips only`)
    }
  } catch (err) {
    console.warn(`trips: travel-times.json read/parse failed for ${systemId}; returning conservative trips only:`, err)
  }

  let snaps
  try {
    snaps = await readSnapshotsForRange(env.GBFS_R2, systemId, sinceTs, untilTs)
  } catch (err) {
    console.error(`trips: R2/parquet read failed for ${systemId}:`, err)
    return jsonResponse<TripsError>({ error: 'failed to read trip archive' }, 502)
  }

  const allTrips = tripsFromSnapshots(snaps, maxBikesEver, matrix)
  // Snapshots include a 1h pad on each side so trips straddling a
  // partition boundary still pair. Clip back to the exact requested window.
  const trips = allTrips.filter(t => t.departure_ts >= sinceTs && t.departure_ts <= untilTs)

  return jsonResponse<TripsResponse>({ trips, since: sinceTs, until: untilTs }, 200, 'max-age=60')
}

// ─── Historical pin rewind (#52) ──────────────────────────────────────
//
// /flow's v1 ships animated bikes, but pin counts always reflect "now"
// rather than the scrubbed cursor — a visible caveat in the caption.
// This endpoint returns station-by-station bike/dock counts at ~2 min
// cadence over [since, until], pulled from the same R2 parquet archive
// the trips endpoint reads. Frontend bisects the resulting array on
// every cursor change to refresh pin rendering.
//
// Data is immutable once written (poller → compaction → R2 parquet),
// so the worker caches aggressively (max-age=600).
//
// Downsampling happens here, not client-side, so we don't ship the
// full ~30s-cadence archive over the wire. step=120 (2 min) is the
// default — fine enough that pin counts feel responsive to the
// 30s/min ticks the user scrubs through.

const SNAPSHOTS_MAX_WINDOW_SEC = 7 * 86400
const SNAPSHOTS_DEFAULT_STEP_SEC = 120
const SNAPSHOTS_MIN_STEP_SEC = 60
const SNAPSHOTS_MAX_STEP_SEC = 3600

type SnapshotsResponse = {
  snapshots: Array<{
    ts: number
    stations: Array<{
      station_id: string
      num_bikes_available: number
      num_docks_available: number
    }>
  }>
  since: number
  until: number
  step: number
}
type SnapshotsError = { error: string }

async function handleSnapshots(
  env: Env,
  systemId: string,
  sinceTs: number,
  untilTs: number,
  stepSec: number,
): Promise<Response> {
  if (!Number.isFinite(sinceTs) || !Number.isFinite(untilTs)) {
    return jsonResponse<SnapshotsError>({ error: 'since and until must be unix-second integers' }, 400)
  }
  if (untilTs <= sinceTs) {
    return jsonResponse<SnapshotsError>({ error: 'until must be greater than since' }, 400)
  }
  if (untilTs - sinceTs > SNAPSHOTS_MAX_WINDOW_SEC) {
    return jsonResponse<SnapshotsError>(
      { error: `window must be <= ${SNAPSHOTS_MAX_WINDOW_SEC} seconds (7 days)` },
      400,
    )
  }
  if (!Number.isFinite(stepSec) || stepSec < SNAPSHOTS_MIN_STEP_SEC || stepSec > SNAPSHOTS_MAX_STEP_SEC) {
    return jsonResponse<SnapshotsError>(
      { error: `step must be between ${SNAPSHOTS_MIN_STEP_SEC} and ${SNAPSHOTS_MAX_STEP_SEC} seconds` },
      400,
    )
  }

  let snaps
  try {
    snaps = await readDockSnapshotsForRange(env.GBFS_R2, systemId, sinceTs, untilTs)
  } catch (err) {
    console.error(`snapshots: R2/parquet read failed for ${systemId}:`, err)
    return jsonResponse<SnapshotsError>({ error: 'failed to read snapshot archive' }, 502)
  }

  // The R2 reader pads by 1h on each side (same as the trips path) so we
  // see snapshots straddling partition boundaries. Clip back to the exact
  // requested window before downsampling so the caller's bisect stays in
  // bounds.
  const inWindow = snaps.filter(s => s.ts >= sinceTs && s.ts <= untilTs)
  const sampled = downsampleSnapshots(inWindow, stepSec)

  return jsonResponse<SnapshotsResponse>(
    { snapshots: sampled, since: sinceTs, until: untilTs, step: stepSec },
    200,
    'max-age=600',
  )
}

function jsonResponse<T>(body: T, status: number, cacheControl?: string): Response {
  const headers: Record<string, string> = {
    ...CORS_HEADERS,
    'content-type': 'application/json',
  }
  if (cacheControl) headers['cache-control'] = cacheControl
  return new Response(JSON.stringify(body), { status, headers })
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

    if (url.pathname.match(BEACON_RE)) {
      return handleBeacon(req, env)
    }

    if (url.pathname.match(INSIGHTS_RE)) {
      return handleInsights(url, env)
    }

    if (url.pathname.match(GEOCODE_RE)) {
      return handleGeocode(url, env)
    }

    const activity = url.pathname.match(ACTIVITY_RE)
    if (activity) {
      const systemId = activity[1]!
      const obj = await env.GBFS_R2.get(activityR2Key(systemId))
      const raw = obj ? await obj.text() : null
      const body = raw ?? JSON.stringify({ events: [], trips: [], inFlightFromStationId: null, inFlightDepartureTs: null })
      return new Response(body, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'content-type': 'application/json',
          'cache-control': 'max-age=20',
        },
      })
    }

    const trips = url.pathname.match(TRIPS_RE)
    if (trips) {
      const systemId = trips[1]!
      const sinceTs = Number(url.searchParams.get('since') ?? 'NaN')
      const untilTs = Number(url.searchParams.get('until') ?? 'NaN')
      return handleTrips(env, systemId, sinceTs, untilTs)
    }

    const snapshots = url.pathname.match(SNAPSHOTS_RE)
    if (snapshots) {
      const systemId = snapshots[1]!
      const sinceTs = Number(url.searchParams.get('since') ?? 'NaN')
      const untilTs = Number(url.searchParams.get('until') ?? 'NaN')
      const stepRaw = url.searchParams.get('step')
      const stepSec = stepRaw === null ? SNAPSHOTS_DEFAULT_STEP_SEC : Number(stepRaw)
      return handleSnapshots(env, systemId, sinceTs, untilTs, stepSec)
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
