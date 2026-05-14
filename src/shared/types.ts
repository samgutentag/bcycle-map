export type SystemInfo = {
  system_id: string
  name: string
  timezone: string
  language: string
}

export type StationStatic = {
  station_id: string
  name: string
  lat: number
  lon: number
  address?: string
}

export type StationDynamic = {
  station_id: string
  num_bikes_available: number
  num_docks_available: number
  bikes_electric: number
  bikes_classic: number
  bikes_smart: number
  is_installed: boolean
  is_renting: boolean
  is_returning: boolean
  last_reported: number
}

export type StationSnapshot = StationStatic & StationDynamic

/**
 * Per-hour min/max of the system-wide sum(num_bikes_available). Maintained
 * as a 24-element rolling window by the poller. Used to render mini-sparklines
 * on the live map's stats card without a separate API call.
 */
export type HourBikeStats = {
  hour_ts: number       // unix seconds, top of the hour (UTC)
  bikes_max: number     // highest sum(bikes_available) observed in that hour
  bikes_min: number     // lowest (a proxy for peak active-riders in the hour)
}

export type KVValue = {
  system: SystemInfo
  snapshot_ts: number
  stations: StationSnapshot[]
  /**
   * Highest value of sum(num_bikes_available) the poller has ever observed.
   * A proxy for "total bikes in the fleet" — peak parked = closest we get
   * to seeing every bike at once. Grows monotonically; converges to truth
   * within a day or two of polling.
   */
  max_bikes_ever?: number
  /** Rolling 24-hour window of per-hour bikes-available min/max. */
  recent24h?: HourBikeStats[]
}

export type BufferEntry = {
  snapshot_ts: number
  stations: StationDynamic[]
}

export class NormalizeError extends Error {
  constructor(message: string, public field?: string) {
    super(message)
    this.name = 'NormalizeError'
  }
}
