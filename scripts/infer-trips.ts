/**
 * Apply trip inference to the current activity log: for each unpaired
 * arrival, pick the unpaired departure whose duration most closely
 * matches the travel-time matrix's expected minutes for that pair.
 * Idempotent — existing trips are preserved and won't re-pair.
 */
import type { ActivityLog, Trip } from '../src/shared/types'
import { activityKey, emptyActivityLog } from '../src/shared/activity'
import { inferTrips, type SimpleMatrix } from '../src/shared/trip-inference'

type KVClient = {
  get(key: string): Promise<string | null>
  put(key: string, body: string): Promise<void>
}

function makeKVClient(opts: { accountId: string; namespaceId: string; token: string }): KVClient {
  const base = `https://api.cloudflare.com/client/v4/accounts/${opts.accountId}/storage/kv/namespaces/${opts.namespaceId}`
  const headers = { authorization: `Bearer ${opts.token}` }
  return {
    get: async (key) => {
      const res = await fetch(`${base}/values/${encodeURIComponent(key)}`, { headers })
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`KV get ${res.status}`)
      return await res.text()
    },
    put: async (key, body) => {
      const res = await fetch(`${base}/values/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { ...headers, 'content-type': 'application/octet-stream' },
        body,
      })
      if (!res.ok) throw new Error(`KV put ${res.status}: ${await res.text()}`)
    },
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = process.env
  for (const k of ['CF_ACCOUNT_ID', 'CF_KV_API_TOKEN', 'CF_KV_NAMESPACE_ID', 'SYSTEM_ID']) {
    if (!env[k]) throw new Error(`missing env ${k}`)
  }
  const R2_PUBLIC_URL_DEFAULT = 'https://pub-83059e704dd64536a5166ab289eb42e5.r2.dev'
  ;(async () => {
    const systemId = env.SYSTEM_ID!
    const kv = makeKVClient({
      accountId: env.CF_ACCOUNT_ID!,
      namespaceId: env.CF_KV_NAMESPACE_ID!,
      token: env.CF_KV_API_TOKEN!,
    })

    // Fetch the travel-time matrix from R2 (public bucket — no auth needed).
    const matrixUrl = `${env.R2_PUBLIC_URL || R2_PUBLIC_URL_DEFAULT}/gbfs/${systemId}/travel-times.json`
    console.log(`Fetching matrix from ${matrixUrl}`)
    const mres = await fetch(matrixUrl)
    if (!mres.ok) throw new Error(`matrix fetch ${mres.status}`)
    const matrixData = await mres.json() as { edges: SimpleMatrix }
    const edges = matrixData.edges
    console.log(`Matrix has ${Object.keys(edges).length} origin stations.`)

    const aKey = activityKey(systemId)
    const raw = await kv.get(aKey)
    const log: ActivityLog = raw ? JSON.parse(raw) : emptyActivityLog()
    console.log(`Activity log: ${log.events.length} events, ${log.trips.length} existing trips.`)

    const newTrips = inferTrips(log.events, edges, log.trips)
    console.log(`Inferred ${newTrips.length} new trips.`)
    for (const t of newTrips) {
      const depDate = new Date(t.departure_ts * 1000).toISOString()
      const minutes = Math.round(t.duration_sec / 60)
      const expected = edges[t.from_station_id]?.[t.to_station_id]?.minutes
      console.log(`  ${depDate}  ${t.from_station_id} → ${t.to_station_id}  ${minutes}m (exp ${expected ?? '?'})`)
    }

    if (newTrips.length === 0) {
      console.log('Nothing to write.')
      return
    }

    const allTrips: Trip[] = [...log.trips, ...newTrips]
      .sort((a, b) => a.departure_ts - b.departure_ts)
      .slice(-50)  // match storage cap

    const next: ActivityLog = {
      ...log,
      trips: allTrips,
    }
    await kv.put(aKey, JSON.stringify(next))
    console.log(`Wrote ${next.trips.length} total trips back to ${aKey}.`)
  })().catch(err => {
    console.error('infer-trips failed:', err)
    process.exit(1)
  })
}
