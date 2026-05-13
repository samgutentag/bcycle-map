import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  normalizeStationInformation,
  normalizeStationStatus,
  normalizeSystemInformation,
  mergeSnapshot,
} from './normalize'

const fixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/station-information-v1.1.json'), 'utf8')
)

const statusFixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/station-status-v1.1.json'), 'utf8')
)

const sysFixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/system-information-v1.1.json'), 'utf8')
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

describe('normalizeStationStatus', () => {
  it('returns one StationDynamic per upstream status entry', () => {
    const result = normalizeStationStatus(statusFixture)
    expect(result.length).toBe(statusFixture.data.stations.length)
  })

  it('flattens num_bikes_available_types into three columns', () => {
    const result = normalizeStationStatus(statusFixture)
    const upstream = statusFixture.data.stations[0]
    const out = result.find(s => s.station_id === upstream.station_id)
    expect(out!.bikes_electric).toBe(upstream.num_bikes_available_types.electric ?? 0)
    expect(out!.bikes_classic).toBe(upstream.num_bikes_available_types.classic ?? 0)
    expect(out!.bikes_smart).toBe(upstream.num_bikes_available_types.smart ?? 0)
  })

  it('coerces is_installed/is_renting/is_returning to booleans', () => {
    const result = normalizeStationStatus(statusFixture)
    const out = result[0]
    expect(typeof out.is_installed).toBe('boolean')
    expect(typeof out.is_renting).toBe('boolean')
    expect(typeof out.is_returning).toBe('boolean')
  })

  it('coerces 0 to false', () => {
    const synthetic = { data: { stations: [{
      station_id: 'x', num_bikes_available: 0, num_docks_available: 5,
      is_installed: 1, is_renting: 0, is_returning: 1, last_reported: 0,
    }] } }
    const result = normalizeStationStatus(synthetic as any)
    expect(result[0].is_renting).toBe(false)
    expect(result[0].is_installed).toBe(true)
  })

  it('throws NormalizeError when stations array is missing', () => {
    expect(() => normalizeStationStatus({ data: {} } as any)).toThrow(/stations/)
  })
})

describe('normalizeSystemInformation', () => {
  it('extracts system_id, name, timezone, language', () => {
    const out = normalizeSystemInformation(sysFixture)
    expect(out.system_id).toBe(sysFixture.data.system_id)
    expect(out.name).toBe(sysFixture.data.name)
    expect(out.timezone).toBe(sysFixture.data.timezone)
    expect(out.language).toBe(sysFixture.data.language)
  })
})

describe('mergeSnapshot', () => {
  it('joins static and dynamic by station_id', () => {
    const statics = normalizeStationInformation(fixture)
    const dyns = normalizeStationStatus(statusFixture)
    const merged = mergeSnapshot(statics, dyns)
    expect(merged.length).toBeGreaterThan(0)
    const first = merged[0]
    expect(first).toHaveProperty('lat')
    expect(first).toHaveProperty('num_bikes_available')
  })

  it('drops dynamic entries with no matching static record', () => {
    const statics = normalizeStationInformation(fixture).slice(0, 1)
    const dyns = normalizeStationStatus(statusFixture)
    const merged = mergeSnapshot(statics, dyns)
    expect(merged.length).toBe(1)
  })
})
