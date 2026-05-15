export type RouteCacheStation = { id: string; lat: number; lon: number }

export type RouteEdge = {
  /** Google-encoded overview_polyline from the Directions response */
  polyline: string
  /** Distance from the Directions response, in meters */
  meters: number
  /** Duration from the Directions response (bike profile), in seconds */
  seconds: number
  /** IDs of stations within 150m of any polyline vertex, sorted by closest-vertex distance ascending */
  via_station_ids: string[]
}

export type RouteCache = {
  computedAt: number
  stations: RouteCacheStation[]
  edges: Record<string, Record<string, RouteEdge>>
}

export function lookupRoute(
  cache: RouteCache | null,
  fromId: string | null | undefined,
  toId: string | null | undefined,
): RouteEdge | null {
  if (!cache || !fromId || !toId) return null
  return cache.edges[fromId]?.[toId] ?? null
}
