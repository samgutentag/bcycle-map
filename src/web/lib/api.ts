import type { KVValue, ActivityLog } from '@shared/types'

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
