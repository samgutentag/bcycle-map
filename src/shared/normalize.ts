import { NormalizeError, StationDynamic, StationStatic } from './types'

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
