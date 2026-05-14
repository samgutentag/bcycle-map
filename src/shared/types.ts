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

/**
 * Per-tick movement event: a station's `num_bikes_available` decreased
 * (departure) or increased (arrival) relative to the previous snapshot.
 * `delta` is the magnitude (always positive); `type` carries the sign.
 */
export type ActivityEvent = {
  ts: number             // unix seconds (snapshot_ts of the detecting tick)
  station_id: string
  type: 'departure' | 'arrival'
  delta: number          // absolute change, always >= 1
}

/**
 * Inferred end-to-end trip when the system transitions cleanly through a
 * single active rider: at time `departure_ts` the system goes from 0 active
 * to 1 (and one station had a single -1 delta), then at `arrival_ts` the
 * system goes from 1 active to 0 (one station with +1 delta). Both stations
 * are captured so we can compare actual ride time against the matrix's
 * expected minutes.
 */
export type Trip = {
  departure_ts: number
  arrival_ts: number
  from_station_id: string
  to_station_id: string
  duration_sec: number   // arrival_ts - departure_ts
}

/**
 * Stored under `system:<id>:activity`. Capped to the most recent N events
 * and most recent N trips (oldest dropped first).
 */
export type ActivityLog = {
  events: ActivityEvent[]
  trips: Trip[]
  /** Station id of the most recent unpaired departure when active-riders
   * just transitioned 0 → 1. Cleared once the corresponding arrival lands. */
  inFlightFromStationId?: string | null
  inFlightDepartureTs?: number | null
}

export class NormalizeError extends Error {
  constructor(message: string, public field?: string) {
    super(message)
    this.name = 'NormalizeError'
  }
}
