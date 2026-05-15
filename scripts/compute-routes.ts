import { S3Client } from '@aws-sdk/client-s3'
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import {
  haversineMeters,
  diffStations,
  pairsToRecompute,
  allPairs,
  type Station,
} from './compute-travel-times'
import { decodePolyline } from '../src/shared/polyline'
import type { RouteCache, RouteEdge } from '../src/shared/route-cache'

const DIRECTIONS_INTER_CALL_DELAY_MS = 100
const VIA_DISTANCE_M = 150
const CONSECUTIVE_FAILURE_ABORT_THRESHOLD = 5

type Env = {
  CF_ACCOUNT_ID?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
  R2_BUCKET?: string
  GOOGLE_MAPS_API_KEY?: string
  SYSTEM_ID?: string
  API_BASE?: string
  MODE?: string
}

function requireEnv(env: Env, key: keyof Env): string {
  const v = env[key]
  if (!v) throw new Error(`Missing env var: ${key}`)
  return v
}

async function r2GetRoutes(s3: S3Client, bucket: string, key: string): Promise<RouteCache | null> {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    const text = await r.Body!.transformToString()
    return JSON.parse(text) as RouteCache
  } catch (e: any) {
    if (e?.Code === 'NoSuchKey' || e?.name === 'NoSuchKey') return null
    throw e
  }
}

async function r2PutRoutes(s3: S3Client, bucket: string, key: string, body: string): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: 'application/json',
    CacheControl: 'public, max-age=300',
  }))
}

async function fetchCurrentStations(apiBase: string, systemId: string): Promise<Station[]> {
  const r = await fetch(`${apiBase}/api/systems/${systemId}/current`)
  if (!r.ok) throw new Error(`fetchCurrentStations failed: ${r.status}`)
  const json = await r.json() as { stations: Array<{ station_id: string; lat: number; lon: number }> }
  return json.stations.map(s => ({ id: s.station_id, lat: s.lat, lon: s.lon }))
}

async function fetchDirectionsRoute(from: Station, to: Station, apiKey: string): Promise<RouteEdge | null> {
  const url = new URL('https://maps.googleapis.com/maps/api/directions/json')
  url.searchParams.set('origin', `${from.lat},${from.lon}`)
  url.searchParams.set('destination', `${to.lat},${to.lon}`)
  url.searchParams.set('mode', 'bicycling')
  url.searchParams.set('units', 'metric')
  url.searchParams.set('key', apiKey)
  const r = await fetch(url.toString())
  if (!r.ok) throw new Error(`Directions API HTTP ${r.status}`)
  const body = await r.json() as {
    status: string
    routes: Array<{
      overview_polyline: { points: string }
      legs: Array<{ distance: { value: number }; duration: { value: number } }>
    }>
  }
  if (body.status === 'OK' && body.routes.length > 0) {
    const route = body.routes[0]!
    const polyline = route.overview_polyline.points
    const meters = route.legs.reduce((s, l) => s + l.distance.value, 0)
    const seconds = route.legs.reduce((s, l) => s + l.duration.value, 0)
    return { polyline, meters, seconds, via_station_ids: [] }
  }
  if (body.status === 'OK' || body.status === 'ZERO_RESULTS') return null
  throw new Error(`Directions API status: ${body.status}`)
}

function computeViaStations(polyline: string, fromId: string, toId: string, allStations: Station[]): string[] {
  const verts = decodePolyline(polyline)
  if (verts.length === 0) return []
  const matches: Array<{ id: string; minDist: number }> = []
  for (const s of allStations) {
    if (s.id === fromId || s.id === toId) continue
    let minDist = Infinity
    for (const [lng, lat] of verts) {
      const d = haversineMeters(s.lat, s.lon, lat, lng)
      if (d < minDist) minDist = d
      if (minDist <= VIA_DISTANCE_M) break
    }
    if (minDist <= VIA_DISTANCE_M) matches.push({ id: s.id, minDist })
  }
  matches.sort((a, b) => a.minDist - b.minDist)
  return matches.map(m => m.id)
}

type RouteUpdate = { from: string; to: string; edge: RouteEdge }

async function computeRoutesSequential(
  pairs: Array<[Station, Station]>,
  apiKey: string,
  allStations: Station[],
): Promise<RouteUpdate[]> {
  const updates: RouteUpdate[] = []
  let consecutiveFailures = 0
  let lastFailureMsg = ''
  let i = 0
  for (const [from, to] of pairs) {
    i++
    try {
      const edge = await fetchDirectionsRoute(from, to, apiKey)
      if (edge) {
        edge.via_station_ids = computeViaStations(edge.polyline, from.id, to.id, allStations)
        updates.push({ from: from.id, to: to.id, edge })
      }
      consecutiveFailures = 0
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      lastFailureMsg = msg
      console.warn(`directions failed for ${from.id} -> ${to.id}:`, msg)
      consecutiveFailures++
      if (consecutiveFailures >= CONSECUTIVE_FAILURE_ABORT_THRESHOLD) {
        throw new Error(
          `Aborting after ${consecutiveFailures} consecutive Directions API failures. Last error: ${lastFailureMsg}. ` +
          `Likely an auth/quota issue — verify the Directions API is enabled on the GCP project ` +
          `(https://console.cloud.google.com/apis/library/directions-backend.googleapis.com) and that ` +
          `the API key isn't restricted to other APIs.`,
        )
      }
    }
    if (i % 50 === 0) console.log(`  progress: ${i}/${pairs.length} (${updates.length} ok)`)
    await new Promise(r => setTimeout(r, DIRECTIONS_INTER_CALL_DELAY_MS))
  }
  return updates
}

function mergeRouteEdges(
  existing: RouteCache['edges'],
  updates: RouteUpdate[],
  removedIds: Set<string>,
): RouteCache['edges'] {
  const out: RouteCache['edges'] = {}
  for (const fromId of Object.keys(existing)) {
    if (removedIds.has(fromId)) continue
    for (const toId of Object.keys(existing[fromId]!)) {
      if (removedIds.has(toId)) continue
      if (!out[fromId]) out[fromId] = {}
      out[fromId]![toId] = existing[fromId]![toId]!
    }
  }
  for (const u of updates) {
    if (!out[u.from]) out[u.from] = {}
    out[u.from]![u.to] = u.edge
  }
  return out
}

function buildRouteEdgesFromUpdates(updates: RouteUpdate[]): RouteCache['edges'] {
  const out: RouteCache['edges'] = {}
  for (const u of updates) {
    if (!out[u.from]) out[u.from] = {}
    out[u.from]![u.to] = u.edge
  }
  return out
}

if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const env = process.env as Env
    const mode = (env.MODE ?? 'check').trim()
    const systemId = requireEnv(env, 'SYSTEM_ID')
    const apiBase = requireEnv(env, 'API_BASE')
    const bucket = requireEnv(env, 'R2_BUCKET')
    const accountId = requireEnv(env, 'CF_ACCOUNT_ID')
    const accessKeyId = requireEnv(env, 'R2_ACCESS_KEY_ID')
    const secretAccessKey = requireEnv(env, 'R2_SECRET_ACCESS_KEY')

    const s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    })

    const key = `gbfs/${systemId}/routes.json`
    const existing = await r2GetRoutes(s3, bucket, key)
    const current = await fetchCurrentStations(apiBase, systemId)
    const prev: Station[] = existing?.stations ?? []
    const diff = diffStations(prev, current)
    const removedIds = new Set(diff.removed.map(s => s.id))

    const summary = {
      hasChanges: diff.added.length + diff.moved.length + diff.removed.length > 0,
      added: diff.added.map(s => s.id),
      moved: diff.moved.map(s => s.id),
      removed: diff.removed.map(s => s.id),
    }
    console.log(`CHECK_SUMMARY=${JSON.stringify(summary)}`)

    if (mode === 'check') {
      console.log(`check mode (mode=${mode}): no API calls made.`)
      return
    }

    if (!env.GOOGLE_MAPS_API_KEY) throw new Error('Missing env var: GOOGLE_MAPS_API_KEY (required for compute / compute-full)')
    const apiKey = env.GOOGLE_MAPS_API_KEY

    let updates: RouteUpdate[] = []
    let attempted = 0
    if (mode === 'compute-full') {
      const pairs = allPairs(current)
      attempted = pairs.length
      console.log(`compute-full: ${pairs.length} pairs`)
      updates = await computeRoutesSequential(pairs, apiKey, current)
    } else if (mode === 'compute') {
      const changedSet = new Set<string>([...diff.added.map(s => s.id), ...diff.moved.map(s => s.id)])
      if (changedSet.size === 0 && removedIds.size === 0) {
        console.log('No changes detected; routes unchanged.')
        return
      }
      if (changedSet.size > 0) {
        const pairs = pairsToRecompute(current, diff)
        attempted = pairs.length
        console.log(`compute: ${pairs.length} pairs (changed × all + other × changed)`)
        updates = await computeRoutesSequential(pairs, apiKey, current)
      }
    } else {
      throw new Error(`unknown mode: ${mode}`)
    }

    if (attempted > 0 && updates.length === 0) {
      throw new Error(
        `compute-routes produced 0 successful edges out of ${attempted} attempted pairs. ` +
        `Refusing to write an empty cache to R2. Check the Directions API is enabled on the ` +
        `GCP project and the API key isn't restricted to other APIs.`,
      )
    }

    const mergedEdges = mode === 'compute-full'
      ? buildRouteEdgesFromUpdates(updates)
      : mergeRouteEdges(existing?.edges ?? {}, updates, removedIds)

    const cache: RouteCache = {
      computedAt: Math.floor(Date.now() / 1000),
      stations: current.map(s => ({ id: s.id, lat: s.lat, lon: s.lon })),
      edges: mergedEdges,
    }
    await r2PutRoutes(s3, bucket, key, JSON.stringify(cache))
    const edgeCount = Object.keys(mergedEdges).reduce((s, k) => s + Object.keys(mergedEdges[k]!).length, 0)
    console.log(`Wrote ${edgeCount} route edges to ${key} (${updates.length} fresh, mode=${mode})`)
  })().catch(err => {
    console.error('compute-routes failed:', err)
    process.exit(1)
  })
}
