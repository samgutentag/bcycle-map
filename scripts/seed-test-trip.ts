/**
 * One-off: synthesize a departure event that pairs with the arrival the
 * poller already captured, and append the resulting Trip. The new poller
 * code came online mid-rider — the arrival landed, but the departure
 * predates the activity logic and so the trip never paired naturally.
 *
 * Hardcoded inputs assume an isolated single-rider environment; safe to
 * re-run idempotently because it dedupes the synthetic event by station+ts.
 */
import type { ActivityEvent, ActivityLog, Trip } from '../src/shared/types'
import { activityKey, emptyActivityLog } from '../src/shared/activity'

// The arrival the poller captured (West Cota & State at ~01:04 PDT).
const ARRIVAL_STATION_ID = 'bcycle_santabarbara_4852'
// Plausible origin a few blocks down State Street.
const DEPARTURE_STATION_ID = 'bcycle_santabarbara_4858'  // E Figueroa & State (1000 Block)
// Trip duration to synthesize.
const DURATION_SEC = 720  // 12 minutes

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
  ;(async () => {
    const systemId = env.SYSTEM_ID!
    const kv = makeKVClient({
      accountId: env.CF_ACCOUNT_ID!,
      namespaceId: env.CF_KV_NAMESPACE_ID!,
      token: env.CF_KV_API_TOKEN!,
    })

    const key = activityKey(systemId)
    const raw = await kv.get(key)
    const log: ActivityLog = raw ? JSON.parse(raw) : emptyActivityLog()

    // Find the most recent arrival at the target station that lacks a pair.
    const arrival = [...log.events]
      .reverse()
      .find(e => e.type === 'arrival' && e.station_id === ARRIVAL_STATION_ID && e.delta === 1)
    if (!arrival) {
      throw new Error(`could not find an arrival at ${ARRIVAL_STATION_ID} in activity log`)
    }
    console.log(`Found arrival to pair: ts=${arrival.ts} (${new Date(arrival.ts * 1000).toISOString()})`)

    const departureTs = arrival.ts - DURATION_SEC

    // Idempotency: don't re-insert if a matching synthetic event already exists.
    const alreadyExists = log.events.some(e =>
      e.type === 'departure' && e.station_id === DEPARTURE_STATION_ID && e.ts === departureTs)
    if (alreadyExists) {
      console.log('Synthetic departure already present; nothing to do.')
      return
    }

    const departure: ActivityEvent = {
      ts: departureTs,
      station_id: DEPARTURE_STATION_ID,
      type: 'departure',
      delta: 1,
    }

    const trip: Trip = {
      departure_ts: departureTs,
      arrival_ts: arrival.ts,
      from_station_id: DEPARTURE_STATION_ID,
      to_station_id: ARRIVAL_STATION_ID,
      duration_sec: DURATION_SEC,
    }

    const nextEvents = [...log.events, departure].sort((a, b) => a.ts - b.ts)
    const nextTrips = [...log.trips, trip]

    const next: ActivityLog = {
      events: nextEvents,
      trips: nextTrips,
      inFlightFromStationId: log.inFlightFromStationId ?? null,
      inFlightDepartureTs: log.inFlightDepartureTs ?? null,
    }

    await kv.put(key, JSON.stringify(next))
    console.log(`Wrote synthetic departure (${DEPARTURE_STATION_ID} @ ${new Date(departureTs * 1000).toISOString()}) + trip.`)
    console.log(`  Trip: ${DEPARTURE_STATION_ID} → ${ARRIVAL_STATION_ID}, ${DURATION_SEC}s`)
  })().catch(err => {
    console.error('seed-test-trip failed:', err)
    process.exit(1)
  })
}
