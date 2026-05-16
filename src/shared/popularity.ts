export type PairStat = {
  /** Number of inferred trips for this directed pair in the window. */
  count: number
  /** Mean trip duration in seconds across those trips. */
  mean_sec: number
}

export type Popularity = {
  computedAt: number
  windowStartTs: number
  windowEndTs: number
  topStations: Array<{
    station_id: string
    /** departures + arrivals in the window (kept for backwards compat with older rollup files) */
    count: number
    /** Bikes that left this station (sum of departure deltas) */
    departures: number
    /** Bikes that arrived at this station (sum of arrival deltas) */
    arrivals: number
  }>
  topRoutes: Array<{ from_station_id: string; to_station_id: string; count: number }>
  pairStats: Record<string, Record<string, PairStat>>
}

export function lookupPairStat(
  popularity: Popularity | null,
  fromId: string | null | undefined,
  toId: string | null | undefined,
): PairStat | null {
  if (!popularity || !fromId || !toId) return null
  return popularity.pairStats[fromId]?.[toId] ?? null
}
