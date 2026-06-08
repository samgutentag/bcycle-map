export type Corridor = { id: string; label: string }

export type CorridorArtifact = {
  generated_at: number
  source: 'override' | 'regions' | 'derived' | 'override+derived' | 'override+regions'
  corridors: Corridor[]
  assignments: Record<string, string>
}

export type CorridorOverride = {
  corridors: Corridor[]
  assignments: Record<string, string>
}

export type CorridorStation = { station_id: string; name: string; lat: number; lon: number; region_id?: string }
export type GbfsRegion = { region_id: string; region_name: string }

const SECTOR_ORDER = ['north', 'east', 'south', 'west', 'central'] as const
const SECTOR_LABEL: Record<string, string> = {
  north: 'North',
  east: 'East',
  south: 'South',
  west: 'West',
  central: 'Central',
}

function validStations(stations: CorridorStation[]): CorridorStation[] {
  return stations.filter(
    s => Number.isFinite(s.lat) && Number.isFinite(s.lon) && !(s.lat === 0 && s.lon === 0),
  )
}

/**
 * Fallback corridors when a system has neither a curated override nor usable
 * GBFS regions. Splits stations into N/E/S/W sectors by bearing from the
 * centroid, with a 'central' core for stations within 25% of the mean radius.
 * Deterministic: no randomness, no time input.
 */
export function deriveDirectionalCorridors(stations: CorridorStation[]): Omit<CorridorArtifact, 'generated_at' | 'source'> {
  const valid = validStations(stations)
  if (valid.length === 0) return { corridors: [], assignments: {} }

  const cLat = valid.reduce((s, x) => s + x.lat, 0) / valid.length
  const cLon = valid.reduce((s, x) => s + x.lon, 0) / valid.length

  const dist = (s: CorridorStation) => Math.hypot(s.lat - cLat, s.lon - cLon)
  const meanRadius = valid.reduce((s, x) => s + dist(x), 0) / valid.length
  const coreRadius = meanRadius * 0.25

  const assignments: Record<string, string> = {}
  for (const s of valid) {
    if (dist(s) <= coreRadius) {
      assignments[s.station_id] = 'central'
      continue
    }
    const angle = (Math.atan2(s.lon - cLon, s.lat - cLat) * 180) / Math.PI
    const a = (angle + 360) % 360
    if (a >= 315 || a < 45) assignments[s.station_id] = 'north'
    else if (a < 135) assignments[s.station_id] = 'east'
    else if (a < 225) assignments[s.station_id] = 'south'
    else assignments[s.station_id] = 'west'
  }

  const present = new Set(Object.values(assignments))
  const corridors: Corridor[] = SECTOR_ORDER.filter(id => present.has(id)).map(id => ({ id, label: SECTOR_LABEL[id]! }))
  return { corridors, assignments }
}

/**
 * Build corridors from GBFS system_regions + per-station region_id. Returns
 * null when the feed's regions are unusable for this system — either no
 * regions, or no station carries a region_id that resolves to a named region
 * (e.g. Santa Barbara lists a regions feed but its stations have no
 * region_id). A null return signals the caller to fall through to the next
 * tier.
 */
export function corridorsFromRegions(
  stations: CorridorStation[],
  regions: GbfsRegion[],
): Omit<CorridorArtifact, 'generated_at' | 'source'> | null {
  if (!Array.isArray(regions) || regions.length === 0) return null
  const nameById = new Map(regions.map(r => [r.region_id, r.region_name]))

  const assignments: Record<string, string> = {}
  for (const s of stations) {
    if (s.region_id && nameById.has(s.region_id)) {
      assignments[s.station_id] = s.region_id
    }
  }
  if (Object.keys(assignments).length === 0) return null

  const used = new Set(Object.values(assignments))
  const corridors: Corridor[] = regions
    .filter(r => used.has(r.region_id))
    .map(r => ({ id: r.region_id, label: r.region_name }))
  return { corridors, assignments }
}
