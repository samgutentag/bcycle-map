import {
  NormalizeError,
  StationDynamic,
  StationSnapshot,
  StationStatic,
  SystemInfo,
} from './types'

type StationInfoFeed = {
  data?: { stations?: Array<{
    station_id: string
    name: string
    lat: number
    lon: number
    address?: string
  }> }
}

export function normalizeStationInformation(feed: StationInfoFeed): StationStatic[] {
  const stations = feed?.data?.stations
  if (!Array.isArray(stations)) {
    throw new NormalizeError('station_information.data.stations missing', 'stations')
  }
  return stations.map(s => ({
    station_id: s.station_id,
    name: s.name,
    lat: s.lat,
    lon: s.lon,
    address: s.address,
  }))
}

type StationStatusFeed = {
  data?: { stations?: Array<{
    station_id: string
    num_bikes_available: number
    num_docks_available: number
    num_bikes_available_types?: { electric?: number; classic?: number; smart?: number }
    is_installed: number | boolean
    is_renting: number | boolean
    is_returning: number | boolean
    last_reported: number
  }> }
}

export function normalizeStationStatus(feed: StationStatusFeed): StationDynamic[] {
  const stations = feed?.data?.stations
  if (!Array.isArray(stations)) {
    throw new NormalizeError('station_status.data.stations missing', 'stations')
  }
  return stations.map(s => ({
    station_id: s.station_id,
    num_bikes_available: s.num_bikes_available,
    num_docks_available: s.num_docks_available,
    bikes_electric: s.num_bikes_available_types?.electric ?? 0,
    bikes_classic: s.num_bikes_available_types?.classic ?? 0,
    bikes_smart: s.num_bikes_available_types?.smart ?? 0,
    is_installed: Boolean(s.is_installed),
    is_renting: Boolean(s.is_renting),
    is_returning: Boolean(s.is_returning),
    last_reported: s.last_reported,
  }))
}

type SystemInfoFeed = {
  data?: {
    system_id: string
    name: string
    timezone: string
    language: string
  }
}

export function normalizeSystemInformation(feed: SystemInfoFeed): SystemInfo {
  const d = feed?.data
  if (!d) throw new NormalizeError('system_information.data missing', 'data')
  return {
    system_id: d.system_id,
    name: d.name,
    timezone: d.timezone,
    language: d.language,
  }
}

export function mergeSnapshot(
  statics: StationStatic[],
  dyns: StationDynamic[]
): StationSnapshot[] {
  const byId = new Map(statics.map(s => [s.station_id, s]))
  return dyns
    .map(d => {
      const s = byId.get(d.station_id)
      return s ? { ...s, ...d } : null
    })
    .filter((x): x is StationSnapshot => x !== null)
}
