import type { KVValue, ActivityLog, Trip } from '@shared/types'

const API_BASE = import.meta.env.VITE_API_BASE ?? ''

export async function fetchCurrent(systemId: string): Promise<KVValue> {
  const res = await fetch(`${API_BASE}/api/systems/${systemId}/current`)
  if (!res.ok) throw new Error(`current fetch failed: ${res.status}`)
  return await res.json() as KVValue
}

export async function fetchActivity(systemId: string): Promise<ActivityLog> {
  const res = await fetch(`${API_BASE}/api/systems/${systemId}/activity`)
  if (!res.ok) throw new Error(`activity fetch failed: ${res.status}`)
  return await res.json() as ActivityLog
}

/**
 * Bulk trips for an arbitrary [since, until] window — derived server-side
 * from the station_status parquet archive (issue #53). Use this when the
 * window exceeds what the rolling activity log covers (>24h). For ≤24h
 * windows, `fetchActivity` is cheaper and already covers it on quiet days.
 */
export async function fetchTrips(systemId: string, sinceTs: number, untilTs: number): Promise<Trip[]> {
  const url = `${API_BASE}/api/systems/${systemId}/trips?since=${sinceTs}&until=${untilTs}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`trips fetch failed: ${res.status}`)
  const body = await res.json() as { trips: Trip[] }
  return body.trips
}

/**
 * Per-station historical bike/dock counts at a configurable cadence
 * (issue #52). Backs the /flow page's pin-rewind so the pins reflect
 * the scrubbed cursor instead of "now". Data is immutable once written
 * (poller → compaction → R2 parquet) and the worker sets max-age=600,
 * so a single fetch per page load + a binary-search selector is enough.
 */
export type StationSnapshotCount = {
  station_id: string
  num_bikes_available: number
  num_docks_available: number
}
export type HistoricalSnapshot = {
  ts: number
  stations: StationSnapshotCount[]
}

export async function fetchHistoricalSnapshots(
  systemId: string,
  sinceTs: number,
  untilTs: number,
  stepSec = 120,
): Promise<HistoricalSnapshot[]> {
  const url = `${API_BASE}/api/systems/${systemId}/snapshots?since=${sinceTs}&until=${untilTs}&step=${stepSec}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`snapshots fetch failed: ${res.status}`)
  const body = await res.json() as { snapshots: HistoricalSnapshot[] }
  return body.snapshots
}

export type GeocodeResult = { lat: number; lng: number; formatted: string }
export type GeocodeErrorCode = 'ZERO_RESULTS' | 'OVER_QUOTA' | 'INVALID'

/**
 * Calls the worker-proxied geocoding endpoint added for issue #47. The
 * worker holds the GOOGLE_MAPS_API_KEY; the web bundle never sees it.
 * `signal` lets callers abort an in-flight request when a new keystroke
 * arrives, which keeps the shared travel-times quota envelope safe.
 */
export async function geocodeAddress(
  query: string,
  signal?: AbortSignal,
): Promise<GeocodeResult> {
  const url = `${API_BASE}/api/geocode?q=${encodeURIComponent(query)}`
  const res = await fetch(url, { signal })
  const body = await res.json().catch(() => null) as
    | GeocodeResult
    | { error: GeocodeErrorCode }
    | null
  if (!body) {
    const err: Error & { code?: GeocodeErrorCode } = new Error('geocode failed')
    err.code = 'INVALID'
    throw err
  }
  if ('error' in body) {
    const err: Error & { code?: GeocodeErrorCode } = new Error(`geocode failed: ${body.error}`)
    err.code = body.error
    throw err
  }
  return body
}
