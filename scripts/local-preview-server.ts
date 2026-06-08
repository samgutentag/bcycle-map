/**
 * Local multi-network preview server (NOT for production / not committed-as-infra).
 *
 * Serves the endpoints the web app needs to render the live map for every
 * system in systems.json, using the REAL shared logic plus a prod passthrough:
 *   - For systems that already exist in production (e.g. SB), it PROXIES the
 *     deployed read-api so /current and /activity carry the full enrichment
 *     (max_bikes_ever, recent24h, activity feed) — the active-riders counter
 *     and sparklines render exactly like prod.
 *   - For systems not yet in prod (e.g. Cincinnati), it falls back to a live
 *     pollOnce() snapshot and maintains a running max_bikes_ever across polls
 *     so the active-riders counter still renders (starts near 0, climbs as
 *     bikes get used during the preview window).
 *   - Corridors + the systems index come from the real processSystem() logic.
 *
 * Point the web app at it with a .env.local:
 *   VITE_API_BASE=http://<LAN_IP>:8788
 *   VITE_R2_PUBLIC_URL=http://<LAN_IP>:8788
 * then run `vite --host`.
 *
 * Run: npx tsx scripts/local-preview-server.ts   (PORT env optional, default 8788)
 */
import { createServer } from 'node:http'
import { getSystems } from '../src/shared/systems'
import { pollOnce } from '../src/workers/poller'
import { processSystem } from './compute-corridors'
import type { KVValue } from '../src/shared/types'
import type { SystemIndexEntry } from '../src/shared/systems-index'

const PORT = Number(process.env.PORT ?? 8788)
const PROD_API = process.env.PROD_API ?? 'https://bcycle-map-read-api.developer-95b.workers.dev'
const SNAPSHOT_REFRESH_MS = 60_000

type Cache = {
  snapshots: Map<string, KVValue>
  activity: Map<string, string>
  corridors: Map<string, string>
  maxBikes: Map<string, number>
  index: SystemIndexEntry[]
}

const cache: Cache = {
  snapshots: new Map(),
  activity: new Map(),
  corridors: new Map(),
  maxBikes: new Map(),
  index: [],
}

const totalBikes = (snap: KVValue): number =>
  snap.stations.reduce((sum, s) => sum + (s.num_bikes_available ?? 0), 0)

async function tryProdJson(path: string): Promise<unknown | null> {
  try {
    const res = await fetch(`${PROD_API}${path}`)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

async function refreshOneSnapshot(systemId: string, gbfsConfigIndex: number): Promise<void> {
  const sys = getSystems()[gbfsConfigIndex]!
  // Prefer the prod read-api when the system is already live there — it carries
  // max_bikes_ever / recent24h / the real activity feed.
  const prod = (await tryProdJson(`/api/systems/${systemId}/current`)) as KVValue | null
  let snap: KVValue
  if (prod && Array.isArray(prod.stations) && prod.stations.length > 0) {
    snap = prod
  } else {
    snap = await pollOnce(sys)
  }

  // Maintain a running max so the active-riders counter renders even without
  // prod history. Seed from whatever the snapshot already carries.
  const running = Math.max(cache.maxBikes.get(systemId) ?? 0, snap.max_bikes_ever ?? 0, totalBikes(snap))
  cache.maxBikes.set(systemId, running)
  snap.max_bikes_ever = running

  cache.snapshots.set(systemId, snap)

  // Activity feed: proxy prod when available, else empty.
  const act = await tryProdJson(`/api/systems/${systemId}/activity`)
  cache.activity.set(
    systemId,
    act ? JSON.stringify(act) : JSON.stringify({ events: [], trips: [], inFlightFromStationId: null, inFlightDepartureTs: null }),
  )

  console.log(`[snapshot] ${systemId}: ${snap.stations.length} stations, source=${prod ? 'prod' : 'pollOnce'}, max_bikes_ever=${running}`)
}

async function refreshSnapshots(): Promise<void> {
  const systems = getSystems()
  await Promise.all(systems.map((s, i) => refreshOneSnapshot(s.system_id, i).catch(err =>
    console.error(`[snapshot] ${s.system_id} failed:`, err instanceof Error ? err.message : err),
  )))
}

async function refreshCorridorsAndIndex(): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  const index: SystemIndexEntry[] = []
  for (const sys of getSystems()) {
    try {
      const { entry, corridors } = await processSystem(sys, now)
      cache.corridors.set(sys.system_id, corridors)
      index.push(entry)
    } catch (err) {
      console.error(`[corridors] ${sys.system_id} failed:`, err instanceof Error ? err.message : err)
    }
  }
  if (index.length > 0) cache.index = index
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
}

function sendJson(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(payload)
}

const CURRENT_RE = /^\/api\/systems\/([^/]+)\/current$/
const ACTIVITY_RE = /^\/api\/systems\/([^/]+)\/activity$/
const CORRIDORS_RE = /^\/gbfs\/([^/]+)\/corridors\.json$/

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  const path = url.pathname

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    res.end()
    return
  }

  if (path === '/api/systems') {
    sendJson(res, 200, { systems: cache.index, nearestId: null })
    return
  }

  const cur = path.match(CURRENT_RE)
  if (cur) {
    const snap = cache.snapshots.get(cur[1]!)
    if (!snap) { sendJson(res, 404, { error: 'no snapshot yet' }); return }
    sendJson(res, 200, snap)
    return
  }

  const act = path.match(ACTIVITY_RE)
  if (act) {
    sendJson(res, 200, cache.activity.get(act[1]!) ?? { events: [], trips: [], inFlightFromStationId: null, inFlightDepartureTs: null })
    return
  }

  const cor = path.match(CORRIDORS_RE)
  if (cor) {
    const c = cache.corridors.get(cor[1]!)
    if (!c) { sendJson(res, 404, { error: 'no corridors' }); return }
    sendJson(res, 200, c)
    return
  }

  // Every other R2 artifact (routes/travel-times/leaderboards/popularity/typicals)
  // is intentionally absent — the web hooks treat 404 as "no data" and degrade.
  sendJson(res, 404, { error: 'not found in local preview' })
})

async function main() {
  console.log('Seeding preview cache (prod passthrough + live GBFS)…')
  await Promise.all([refreshSnapshots(), refreshCorridorsAndIndex()])
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Local preview server on http://0.0.0.0:${PORT}`)
    console.log(`Systems served: ${cache.index.map(e => e.systemId).join(', ') || '(none — check GBFS reachability)'}`)
  })
  setInterval(() => { refreshSnapshots().catch(() => {}) }, SNAPSHOT_REFRESH_MS)
}

main().catch(err => { console.error('preview server failed to start:', err); process.exit(1) })
