import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'

export type Station = { id: string; lat: number; lon: number }
export type Edge = { minutes: number; meters: number }
export type TravelMatrix = {
  computedAt: number
  stations: Station[]
  edges: Record<string, Record<string, Edge>>
}

export type DiffResult = {
  added: Station[]
  moved: Station[]
  removed: Station[]
}

const HAVERSINE_RADIUS_M = 6371000
const DEFAULT_MOVE_THRESHOLD_M = 50

// Google Distance Matrix API limits
const DM_MAX_ORIGINS_PER_REQUEST = 25
const DM_MAX_DESTINATIONS_PER_REQUEST = 25
const DM_MAX_ELEMENTS_PER_REQUEST = 100
// Tile shape chosen to max out elements per call (25 * 4 = 100)
const DM_TILE_ORIGINS = 25
const DM_TILE_DESTINATIONS = 4
const DM_INTER_CALL_DELAY_MS = 100

export function haversineMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLon = toRad(bLon - aLon)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * HAVERSINE_RADIUS_M * Math.asin(Math.sqrt(a))
}

export function diffStations(prev: Station[], curr: Station[], thresholdMeters = DEFAULT_MOVE_THRESHOLD_M): DiffResult {
  const prevById = new Map(prev.map(s => [s.id, s]))
  const currById = new Map(curr.map(s => [s.id, s]))
  const added: Station[] = []
  const moved: Station[] = []
  const removed: Station[] = []
  for (const s of curr) {
    const p = prevById.get(s.id)
    if (!p) {
      added.push(s)
    } else if (haversineMeters(p.lat, p.lon, s.lat, s.lon) > thresholdMeters) {
      moved.push(s)
    }
  }
  for (const s of prev) {
    if (!currById.has(s.id)) removed.push(s)
  }
  return { added, moved, removed }
}

/**
 * Given a current station list and an existing matrix, return the set of
 * directed edges (A,B) that need (re)computing. An edge needs computing if
 * either endpoint is in `added` or `moved`.
 */
export function pairsToRecompute(currentStations: Station[], diff: DiffResult): Array<[Station, Station]> {
  const changed = new Set<string>()
  for (const s of diff.added) changed.add(s.id)
  for (const s of diff.moved) changed.add(s.id)
  if (changed.size === 0) return []
  const pairs: Array<[Station, Station]> = []
  for (const a of currentStations) {
    for (const b of currentStations) {
      if (a.id === b.id) continue
      if (changed.has(a.id) || changed.has(b.id)) pairs.push([a, b])
    }
  }
  return pairs
}

/**
 * All N*(N-1) directed pairs — used for a full-mode recompute.
 */
export function allPairs(stations: Station[]): Array<[Station, Station]> {
  const pairs: Array<[Station, Station]> = []
  for (const a of stations) {
    for (const b of stations) {
      if (a.id !== b.id) pairs.push([a, b])
    }
  }
  return pairs
}

export function mergeEdges(existing: TravelMatrix['edges'], updates: Array<{ from: string; to: string; edge: Edge }>, removedIds: Set<string>): TravelMatrix['edges'] {
  const next: TravelMatrix['edges'] = {}
  // Carry forward existing edges that aren't being replaced AND don't involve a removed station
  for (const [from, m] of Object.entries(existing)) {
    if (removedIds.has(from)) continue
    next[from] = {}
    for (const [to, edge] of Object.entries(m)) {
      if (removedIds.has(to)) continue
      next[from]![to] = edge
    }
  }
  // Overlay the new edges
  for (const u of updates) {
    if (!next[u.from]) next[u.from] = {}
    next[u.from]![u.to] = u.edge
  }
  return next
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/**
 * Single Distance Matrix API call. Bounded by Google's per-request limits
 * (25 origins, 25 destinations, 100 elements). Returns edges for every
 * non-self pair whose element status is OK.
 */
export async function googleDistanceMatrixBatch(
  origins: Station[],
  destinations: Station[],
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Array<{ from: string; to: string; edge: Edge }>> {
  if (origins.length === 0 || destinations.length === 0) return []
  if (origins.length > DM_MAX_ORIGINS_PER_REQUEST) {
    throw new Error(`Distance Matrix: ${origins.length} origins exceeds limit of ${DM_MAX_ORIGINS_PER_REQUEST}`)
  }
  if (destinations.length > DM_MAX_DESTINATIONS_PER_REQUEST) {
    throw new Error(`Distance Matrix: ${destinations.length} destinations exceeds limit of ${DM_MAX_DESTINATIONS_PER_REQUEST}`)
  }
  if (origins.length * destinations.length > DM_MAX_ELEMENTS_PER_REQUEST) {
    throw new Error(`Distance Matrix: ${origins.length}×${destinations.length}=${origins.length * destinations.length} elements exceeds limit of ${DM_MAX_ELEMENTS_PER_REQUEST}`)
  }
  const originsParam = origins.map(s => `${s.lat},${s.lon}`).join('|')
  const destinationsParam = destinations.map(s => `${s.lat},${s.lon}`).join('|')
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${originsParam}&destinations=${destinationsParam}&mode=bicycling&key=${apiKey}`
  const res = await fetchImpl(url)
  if (!res.ok) throw new Error(`Distance Matrix HTTP ${res.status}`)
  const body = await res.json() as {
    status: string
    error_message?: string
    rows: Array<{ elements: Array<{
      status: string
      duration?: { value: number }
      distance?: { value: number }
    }> }>
  }
  if (body.status !== 'OK') {
    throw new Error(`Distance Matrix status=${body.status}${body.error_message ? `: ${body.error_message}` : ''}`)
  }
  const results: Array<{ from: string; to: string; edge: Edge }> = []
  for (let i = 0; i < origins.length; i++) {
    const row = body.rows[i]
    if (!row) continue
    for (let j = 0; j < destinations.length; j++) {
      const el = row.elements[j]
      if (!el) continue
      const origin = origins[i]!
      const dest = destinations[j]!
      if (origin.id === dest.id) continue
      if (el.status !== 'OK' || !el.duration || !el.distance) {
        console.warn(`Distance Matrix skip ${origin.id}->${dest.id}: ${el.status}`)
        continue
      }
      results.push({
        from: origin.id,
        to: dest.id,
        edge: {
          minutes: Math.round((el.duration.value / 60) * 10) / 10,
          meters: el.distance.value,
        },
      })
    }
  }
  return results
}

/**
 * Tiles a full origins×destinations matrix into Distance Matrix API calls of
 * at most 25×4 = 100 elements each. Sleeps `DM_INTER_CALL_DELAY_MS` between
 * calls to stay well under the per-second element quota.
 */
export async function computeDistanceMatrix(
  origins: Station[],
  destinations: Station[],
  apiKey: string,
  options: {
    delayMs?: number
    fetchImpl?: typeof fetch
    onProgress?: (done: number, total: number) => void
  } = {},
): Promise<Array<{ from: string; to: string; edge: Edge }>> {
  const delayMs = options.delayMs ?? DM_INTER_CALL_DELAY_MS
  const fetchImpl = options.fetchImpl ?? fetch
  const originChunks = chunk(origins, DM_TILE_ORIGINS)
  const destChunks = chunk(destinations, DM_TILE_DESTINATIONS)
  const totalCalls = originChunks.length * destChunks.length
  const results: Array<{ from: string; to: string; edge: Edge }> = []
  let done = 0
  for (const oc of originChunks) {
    for (const dc of destChunks) {
      const batch = await googleDistanceMatrixBatch(oc, dc, apiKey, fetchImpl)
      results.push(...batch)
      done++
      options.onProgress?.(done, totalCalls)
      if (done < totalCalls) await new Promise(r => setTimeout(r, delayMs))
    }
  }
  return results
}

async function r2Get(s3: S3Client, bucket: string, key: string): Promise<TravelMatrix | null> {
  try {
    const got = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    const text = await got.Body!.transformToString()
    return JSON.parse(text) as TravelMatrix
  } catch (e: any) {
    if (e?.Code === 'NoSuchKey' || e?.name === 'NoSuchKey') return null
    throw e
  }
}

async function r2Put(s3: S3Client, bucket: string, key: string, body: string): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: 'application/json',
  }))
}

async function fetchCurrentStations(apiBase: string, systemId: string): Promise<Station[]> {
  const res = await fetch(`${apiBase}/api/systems/${encodeURIComponent(systemId)}/current`)
  if (!res.ok) throw new Error(`current fetch failed: ${res.status}`)
  const body = await res.json() as { stations: Array<{ station_id: string; lat: number; lon: number }> }
  return body.stations.map(s => ({ id: s.station_id, lat: s.lat, lon: s.lon }))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = process.env
  for (const k of ['CF_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'SYSTEM_ID', 'API_BASE', 'MODE']) {
    if (!env[k]) throw new Error(`missing env ${k}`)
  }
  const mode = env.MODE!  // 'check' | 'compute' | 'compute-full'

  ;(async () => {
    const s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${env.CF_ACCOUNT_ID!}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY! },
    })
    const systemId = env.SYSTEM_ID!
    const key = `gbfs/${systemId}/travel-times.json`

    const current = await fetchCurrentStations(env.API_BASE!, systemId)
    const existing = await r2Get(s3, env.R2_BUCKET!, key)
    const diff = diffStations(existing?.stations ?? [], current)

    console.log(`Stations: current=${current.length}, existing=${existing?.stations.length ?? 0}`)
    console.log(`Diff: ${diff.added.length} added, ${diff.moved.length} moved, ${diff.removed.length} removed`)

    if (mode === 'check') {
      const summary = {
        mode: 'check',
        hasChanges: diff.added.length + diff.moved.length + diff.removed.length > 0,
        added: diff.added.map(s => s.id),
        moved: diff.moved.map(s => s.id),
        removed: diff.removed.map(s => s.id),
        currentStationCount: current.length,
        existingStationCount: existing?.stations.length ?? 0,
      }
      console.log('CHECK_SUMMARY=' + JSON.stringify(summary))
      return
    }

    if (!env.GOOGLE_MAPS_API_KEY) throw new Error('compute modes require GOOGLE_MAPS_API_KEY')
    const apiKey = env.GOOGLE_MAPS_API_KEY

    const removedIds = new Set(diff.removed.map(s => s.id))
    let updates: Array<{ from: string; to: string; edge: Edge }> = []

    const logProgress = (label: string) => (done: number, total: number) => {
      if (done % 10 === 0 || done === total) console.log(`  ${label}: ${done}/${total} batches`)
    }

    if (mode === 'compute-full') {
      const elements = current.length * current.length
      console.log(`Full recompute: ${current.length}×${current.length} = ${elements} elements`)
      updates = await computeDistanceMatrix(current, current, apiKey, {
        onProgress: logProgress('full'),
      })
    } else if (mode === 'compute') {
      const changedSet = new Set<string>([...diff.added.map(s => s.id), ...diff.moved.map(s => s.id)])
      if (changedSet.size === 0 && removedIds.size === 0) {
        console.log('No changes detected; matrix unchanged.')
        return
      }
      if (changedSet.size > 0) {
        const changedStations = current.filter(s => changedSet.has(s.id))
        const nonChangedStations = current.filter(s => !changedSet.has(s.id))
        console.log(`Pass A (changed → all): ${changedStations.length} × ${current.length}`)
        const passA = await computeDistanceMatrix(changedStations, current, apiKey, {
          onProgress: logProgress('pass A'),
        })
        console.log(`Pass B (other → changed): ${nonChangedStations.length} × ${changedStations.length}`)
        const passB = await computeDistanceMatrix(nonChangedStations, changedStations, apiKey, {
          onProgress: logProgress('pass B'),
        })
        updates = [...passA, ...passB]
      }
    } else {
      throw new Error(`unknown mode: ${mode}`)
    }

    const mergedEdges = mode === 'compute-full'
      ? buildEdgesFromUpdates(updates)
      : mergeEdges(existing?.edges ?? {}, updates, removedIds)

    const matrix: TravelMatrix = {
      computedAt: Math.floor(Date.now() / 1000),
      stations: current,
      edges: mergedEdges,
    }
    await r2Put(s3, env.R2_BUCKET!, key, JSON.stringify(matrix))
    const edgeCount = Object.keys(mergedEdges).reduce((s, k) => s + Object.keys(mergedEdges[k]!).length, 0)
    console.log(`Wrote ${edgeCount} edges to ${key} (${updates.length} fresh, mode=${mode})`)
  })().catch(err => {
    console.error('travel-times failed:', err)
    process.exit(1)
  })
}

function buildEdgesFromUpdates(updates: Array<{ from: string; to: string; edge: Edge }>): TravelMatrix['edges'] {
  const m: TravelMatrix['edges'] = {}
  for (const u of updates) {
    if (!m[u.from]) m[u.from] = {}
    m[u.from]![u.to] = u.edge
  }
  return m
}
