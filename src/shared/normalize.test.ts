import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeStationInformation } from './normalize'

const fixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/station-information-v1.1.json'), 'utf8')
)

describe('normalizeStationInformation', () => {
  it('returns one StationStatic per upstream station', () => {
    const result = normalizeStationInformation(fixture)
    expect(result.length).toBe(fixture.data.stations.length)
  })

  it('preserves station_id, name, lat, lon, address', () => {
    const result = normalizeStationInformation(fixture)
    const upstream = fixture.data.stations[0]
    const out = result.find(s => s.station_id === upstream.station_id)
    expect(out).toBeDefined()
    expect(out!.name).toBe(upstream.name)
    expect(out!.lat).toBe(upstream.lat)
    expect(out!.lon).toBe(upstream.lon)
    expect(out!.address).toBe(upstream.address)
  })

  it('throws NormalizeError when stations array is missing', () => {
    expect(() => normalizeStationInformation({ data: {} } as any)).toThrow(/stations/)
  })
})
