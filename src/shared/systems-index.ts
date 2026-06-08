export type SystemIndexEntry = {
  systemId: string
  name: string
  gbfsUrl: string
  rentalUrl: string | null
  timezone: string
  centroid: [number, number]              // [lon, lat]
  bbox: [number, number, number, number]  // [minLon, minLat, maxLon, maxLat]
  stationCount: number
}

export type LatLon = { lat: number; lon: number } | null

/**
 * Closest system to `coord` by squared great-circle-ish distance. Uses a
 * cheap equirectangular approximation (good enough to disambiguate cities
 * that are hundreds of km apart). Returns null on empty list or bad input.
 */
export function nearestSystem(entries: SystemIndexEntry[], coord: LatLon): SystemIndexEntry | null {
  if (!entries.length) return null
  if (!coord || !Number.isFinite(coord.lat) || !Number.isFinite(coord.lon)) return null

  let best: SystemIndexEntry | null = null
  let bestD = Infinity
  for (const e of entries) {
    const [lon, lat] = e.centroid
    const dLat = lat - coord.lat
    const dLon = (lon - coord.lon) * Math.cos((coord.lat * Math.PI) / 180)
    const d = dLat * dLat + dLon * dLon
    if (d < bestD) { bestD = d; best = e }
  }
  return best
}
