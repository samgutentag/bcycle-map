import { NormalizeError, StationStatic } from './types'

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
