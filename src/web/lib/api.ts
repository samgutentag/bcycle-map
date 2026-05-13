import type { KVValue } from '@shared/types'

export async function fetchCurrent(systemId: string): Promise<KVValue> {
  const res = await fetch(`/api/systems/${systemId}/current`)
  if (!res.ok) throw new Error(`current fetch failed: ${res.status}`)
  return await res.json() as KVValue
}
