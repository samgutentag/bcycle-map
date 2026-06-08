import { describe, it, expect } from 'vitest'
import { resolveFeeds, indexEntryFor } from './compute-corridors'

describe('resolveFeeds', () => {
  it('builds a name->url map from a GBFS discovery document', () => {
    const discovery = { data: { en: { feeds: [
      { name: 'station_information', url: 'http://x/si.json' },
      { name: 'system_regions', url: 'http://x/sr.json' },
    ] } } }
    const feeds = resolveFeeds(discovery)
    expect(feeds.station_information).toBe('http://x/si.json')
    expect(feeds.system_regions).toBe('http://x/sr.json')
    expect(feeds.station_status).toBeUndefined()
  })
})

describe('indexEntryFor', () => {
  it('drops the 0/0 origin from centroid + bbox but counts all stations', () => {
    const entry = indexEntryFor(
      { system_id: 'sys', name: 'Sys', gbfs_url: 'http://g', version: '1.1' },
      { system_id: 'sys', name: 'Sys', timezone: 'UTC', language: 'en', url: 'http://rent' },
      [
        { station_id: 'a', name: 'a', lat: 0, lon: 0 },
        { station_id: 'b', name: 'b', lat: 2, lon: 4 },
      ],
    )
    expect(entry.systemId).toBe('sys')
    expect(entry.rentalUrl).toBe('http://rent')
    expect(entry.centroid).toEqual([4, 2])      // only station b counts toward bounds
    expect(entry.bbox).toEqual([4, 2, 4, 2])
    expect(entry.stationCount).toBe(2)          // count includes the dropped 0/0
  })

  it('ignores 0/0 and non-finite coords when computing bounds', () => {
    const entry = indexEntryFor(
      { system_id: 'sys', name: 'Sys', gbfs_url: 'http://g', version: '1.1' },
      { system_id: 'sys', name: 'Sys', timezone: 'UTC', language: 'en', url: null },
      [
        { station_id: 'a', name: 'a', lat: 0, lon: 0 },
        { station_id: 'b', name: 'b', lat: 10, lon: 20 },
        { station_id: 'c', name: 'c', lat: 12, lon: 24 },
      ],
    )
    expect(entry.centroid).toEqual([22, 11])
    expect(entry.stationCount).toBe(3)
  })
})
