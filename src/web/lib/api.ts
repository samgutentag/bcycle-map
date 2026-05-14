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
