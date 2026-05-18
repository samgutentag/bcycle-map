import { describe, expect, it } from 'vitest'
import type { StationSnapshot } from '@shared/types'
import {
  applyMapFilters,
  DEFAULT_FILTERS,
  hasActiveFilter,
  isStationOffline,
  MIN_BIKES_CYCLE,
  nextMinBikes,
  readFiltersFromSearch,
  writeFiltersToSearch,
} from './map-filters'

function station(overrides: Partial<StationSnapshot> & { id: string }): StationSnapshot {
  return {
    station_id: overrides.id,
    name: overrides.name ?? `Station ${overrides.id}`,
    lat: overrides.lat ?? 34.4208,
    lon: overrides.lon ?? -119.6982,
    num_bikes_available: overrides.num_bikes_available ?? 0,
    num_docks_available: overrides.num_docks_available ?? 0,
    bikes_electric: overrides.bikes_electric ?? 0,
    bikes_classic: overrides.bikes_classic ?? 0,
    bikes_smart: overrides.bikes_smart ?? 0,
    is_installed: overrides.is_installed ?? true,
    is_renting: overrides.is_renting ?? true,
    is_returning: overrides.is_returning ?? true,
    last_reported: overrides.last_reported ?? 0,
    address: overrides.address,
  } as StationSnapshot
}

const STATIONS: StationSnapshot[] = [
  station({ id: 'empty', num_bikes_available: 0 }),
  station({ id: 'one', num_bikes_available: 1 }),
  station({ id: 'three', num_bikes_available: 3 }),
  station({ id: 'five', num_bikes_available: 5 }),
  station({ id: 'ten', num_bikes_available: 10 }),
  station({ id: 'not-renting', num_bikes_available: 4, is_renting: false }),
  station({ id: 'not-returning', num_bikes_available: 2, is_returning: false }),
  station({ id: 'not-installed', num_bikes_available: 0, is_installed: false }),
]

describe('applyMapFilters', () => {
  it('returns every station with default filters', () => {
    const out = applyMapFilters(STATIONS, DEFAULT_FILTERS)
    expect(out).toHaveLength(STATIONS.length)
  })

  it('filters by minBikes (>= threshold)', () => {
    const out = applyMapFilters(STATIONS, { minBikes: 3, offlineOnly: false })
    expect(out.map(s => s.station_id)).toEqual(['three', 'five', 'ten', 'not-renting'])
  })

  it('passes everything when minBikes is 0', () => {
    const out = applyMapFilters(STATIONS, { minBikes: 0, offlineOnly: false })
    expect(out).toHaveLength(STATIONS.length)
  })

  it('keeps only offline stations when offlineOnly is true', () => {
    const out = applyMapFilters(STATIONS, { minBikes: 0, offlineOnly: true })
    expect(out.map(s => s.station_id).sort()).toEqual(['not-installed', 'not-renting', 'not-returning'])
  })

  it('combines both filters', () => {
    // minBikes 3 AND offline → 'not-renting' has 4 bikes and is offline
    const out = applyMapFilters(STATIONS, { minBikes: 3, offlineOnly: true })
    expect(out.map(s => s.station_id)).toEqual(['not-renting'])
  })

  it('returns a new array (does not mutate input)', () => {
    const out = applyMapFilters(STATIONS, DEFAULT_FILTERS)
    expect(out).not.toBe(STATIONS)
  })
})

describe('isStationOffline', () => {
  it('returns true if any of the three flags is false', () => {
    expect(isStationOffline(station({ id: 'a', is_renting: false }))).toBe(true)
    expect(isStationOffline(station({ id: 'b', is_returning: false }))).toBe(true)
    expect(isStationOffline(station({ id: 'c', is_installed: false }))).toBe(true)
  })

  it('returns false when all three flags are true', () => {
    expect(isStationOffline(station({ id: 'ok' }))).toBe(false)
  })
})

describe('nextMinBikes', () => {
  it('cycles through Any → 1 → 3 → 5 → Any', () => {
    expect(nextMinBikes(0)).toBe(1)
    expect(nextMinBikes(1)).toBe(3)
    expect(nextMinBikes(3)).toBe(5)
    expect(nextMinBikes(5)).toBe(0)
  })

  it('resets to first step when current value is off-cycle', () => {
    expect(nextMinBikes(99)).toBe(MIN_BIKES_CYCLE[0])
  })
})

describe('URL serialization', () => {
  it('reads defaults when params are empty', () => {
    expect(readFiltersFromSearch(new URLSearchParams())).toEqual(DEFAULT_FILTERS)
  })

  it('reads minBikes and offlineOnly', () => {
    const params = new URLSearchParams('bikes=3&offline=1')
    expect(readFiltersFromSearch(params)).toEqual({ minBikes: 3, offlineOnly: true })
  })

  it('clamps unknown bikes value to nearest known step', () => {
    expect(readFiltersFromSearch(new URLSearchParams('bikes=4')).minBikes).toBe(3)
    expect(readFiltersFromSearch(new URLSearchParams('bikes=100')).minBikes).toBe(5)
    expect(readFiltersFromSearch(new URLSearchParams('bikes=-1')).minBikes).toBe(0)
    expect(readFiltersFromSearch(new URLSearchParams('bikes=abc')).minBikes).toBe(0)
  })

  it('treats offline values other than "1" as off', () => {
    expect(readFiltersFromSearch(new URLSearchParams('offline=0')).offlineOnly).toBe(false)
    expect(readFiltersFromSearch(new URLSearchParams('offline=true')).offlineOnly).toBe(false)
  })

  it('writes filters and omits defaults', () => {
    const out = writeFiltersToSearch(new URLSearchParams(), { minBikes: 5, offlineOnly: true })
    expect(out.toString()).toBe('bikes=5&offline=1')
  })

  it('omits defaults from the URL', () => {
    const out = writeFiltersToSearch(new URLSearchParams('foo=bar'), DEFAULT_FILTERS)
    expect(out.toString()).toBe('foo=bar')
  })

  it('preserves unrelated params', () => {
    const out = writeFiltersToSearch(
      new URLSearchParams('nearby=open'),
      { minBikes: 1, offlineOnly: false },
    )
    expect(out.get('nearby')).toBe('open')
    expect(out.get('bikes')).toBe('1')
    expect(out.get('offline')).toBeNull()
  })

  it('round-trips arbitrary filter values', () => {
    const originals: { minBikes: number; offlineOnly: boolean }[] = [
      { minBikes: 0, offlineOnly: false },
      { minBikes: 1, offlineOnly: false },
      { minBikes: 3, offlineOnly: true },
      { minBikes: 5, offlineOnly: true },
      { minBikes: 0, offlineOnly: true },
    ]
    for (const f of originals) {
      const written = writeFiltersToSearch(new URLSearchParams(), f)
      const read = readFiltersFromSearch(written)
      expect(read).toEqual(f)
    }
  })

  it('clears bikes/offline keys when written with defaults', () => {
    const out = writeFiltersToSearch(
      new URLSearchParams('bikes=3&offline=1&nearby=open'),
      DEFAULT_FILTERS,
    )
    expect(out.get('bikes')).toBeNull()
    expect(out.get('offline')).toBeNull()
    expect(out.get('nearby')).toBe('open')
  })
})

describe('hasActiveFilter', () => {
  it('is false for defaults', () => {
    expect(hasActiveFilter(DEFAULT_FILTERS)).toBe(false)
  })

  it('is true when either filter is active', () => {
    expect(hasActiveFilter({ minBikes: 1, offlineOnly: false })).toBe(true)
    expect(hasActiveFilter({ minBikes: 0, offlineOnly: true })).toBe(true)
    expect(hasActiveFilter({ minBikes: 5, offlineOnly: true })).toBe(true)
  })
})
