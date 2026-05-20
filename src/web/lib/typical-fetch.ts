import type { TypicalProfile } from './typical-comparison'

/**
 * Fetch the precomputed typical profile for a single station. The worker
 * synthesizes an empty 24-hour shape (daysCovered=0) when no parquet
 * history exists yet, so a `200` with `daysCovered < 3` is the normal
 * "no baseline yet" state — not an error.
 */
export async function fetchStationTypical(
  apiBase: string,
  systemId: string,
  stationId: string,
  init?: RequestInit,
): Promise<TypicalProfile> {
  const res = await fetch(
    `${apiBase}/api/systems/${encodeURIComponent(systemId)}/stations/${encodeURIComponent(stationId)}/recent`,
    init,
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as TypicalProfile
}
