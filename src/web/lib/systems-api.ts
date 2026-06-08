import type { SystemIndexEntry } from '@shared/systems-index'

const API_BASE = import.meta.env.VITE_API_BASE ?? ''

export type SystemsResponse = { systems: SystemIndexEntry[]; nearestId: string | null }

export async function fetchSystems(): Promise<SystemsResponse> {
  const res = await fetch(`${API_BASE}/api/systems`)
  if (!res.ok) throw new Error(`systems fetch failed: ${res.status}`)
  return (await res.json()) as SystemsResponse
}
