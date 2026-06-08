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
    const out = applyMapFilters(STATIONS, { minBikes: 3, corridor: null })
    expect(out.map(s => s.station_id)).toEqual(['three', 'five', 'ten', 'not-renting'])
  })

  it('passes everything when minBikes is 0', () => {
    const out = applyMapFilters(STATIONS, { minBikes: 0, corridor: null })
    expect(out).toHaveLength(STATIONS.length)
  })

  it('filters by corridor using the supplied lookup map', () => {
    const corridorMap = new Map<string, 'eastside' | 'waterfront'>([
      ['one', 'eastside'],
      ['three', 'eastside'],
      ['five', 'waterfront'],
    ])
    const out = applyMapFilters(
      STATIONS,
      { minBikes: 0, corridor: 'eastside' },
      corridorMap as Map<string, never>,
    )
    expect(out.map(s => s.station_id)).toEqual(['one', 'three'])
  })

  it('stations missing from the corridor map drop out when a corridor is selected', () => {
    const corridorMap = new Map<string, 'eastside'>([['one', 'eastside']])
    const out = applyMapFilters(
      STATIONS,
      { minBikes: 0, corridor: 'eastside' },
      corridorMap as Map<string, never>,
    )
    expect(out.map(s => s.station_id)).toEqual(['one'])
  })

  it('treats the corridor filter as inactive when corridor is null', () => {
    // No corridor map needed in this path
    const out = applyMapFilters(STATIONS, DEFAULT_FILTERS)
    expect(out).toHaveLength(STATIONS.length)
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

  it('reads minBikes', () => {
    const params = new URLSearchParams('bikes=3')
    expect(readFiltersFromSearch(params)).toEqual({ minBikes: 3, corridor: null })
  })

  it('reads a known corridor id', () => {
    const params = new URLSearchParams('corridor=waterfront')
    expect(readFiltersFromSearch(params).corridor).toBe('waterfront')
  })

  it('accepts any non-empty corridor id (validity is enforced by the chip options)', () => {
    // The URL carries an opaque corridor id; readFiltersFromSearch no longer
    // validates it against a known set. The chip constrains the choices.
    const params = new URLSearchParams('corridor=mars')
    expect(readFiltersFromSearch(params).corridor).toBe('mars')
  })

  it('falls back to null for an empty corridor value', () => {
    const params = new URLSearchParams('corridor=')
    expect(readFiltersFromSearch(params).corridor).toBeNull()
  })

  it('clamps unknown bikes value to nearest known step', () => {
    expect(readFiltersFromSearch(new URLSearchParams('bikes=4')).minBikes).toBe(3)
    expect(readFiltersFromSearch(new URLSearchParams('bikes=100')).minBikes).toBe(5)
    expect(readFiltersFromSearch(new URLSearchParams('bikes=-1')).minBikes).toBe(0)
    expect(readFiltersFromSearch(new URLSearchParams('bikes=abc')).minBikes).toBe(0)
  })

  it('ignores the legacy offline param and visiting /live?offline=1 is a no-op', () => {
    expect(readFiltersFromSearch(new URLSearchParams('offline=1'))).toEqual(DEFAULT_FILTERS)
    expect(readFiltersFromSearch(new URLSearchParams('offline=0'))).toEqual(DEFAULT_FILTERS)
    expect(readFiltersFromSearch(new URLSearchParams('bikes=3&offline=1'))).toEqual({
      minBikes: 3,
      corridor: null,
    })
  })

  it('writes filters and omits defaults', () => {
    const out = writeFiltersToSearch(new URLSearchParams(), { minBikes: 5, corridor: null })
    expect(out.toString()).toBe('bikes=5')
  })

  it('writes the corridor key when a corridor is selected', () => {
    const out = writeFiltersToSearch(new URLSearchParams(), { minBikes: 0, corridor: 'mesa' })
    expect(out.toString()).toBe('corridor=mesa')
  })

  it('clears the corridor key when set back to null', () => {
    const out = writeFiltersToSearch(new URLSearchParams('corridor=mesa'), DEFAULT_FILTERS)
    expect(out.get('corridor')).toBeNull()
  })

  it('omits defaults from the URL', () => {
    const out = writeFiltersToSearch(new URLSearchParams('foo=bar'), DEFAULT_FILTERS)
    expect(out.toString()).toBe('foo=bar')
  })

  it('preserves unrelated params', () => {
    const out = writeFiltersToSearch(
      new URLSearchParams('nearby=open'),
      { minBikes: 1, corridor: null },
    )
    expect(out.get('nearby')).toBe('open')
    expect(out.get('bikes')).toBe('1')
  })

  it('strips the legacy offline param on write so old links self-heal', () => {
    const out = writeFiltersToSearch(
      new URLSearchParams('bikes=3&offline=1&nearby=open'),
      { minBikes: 3, corridor: null },
    )
    expect(out.get('offline')).toBeNull()
    expect(out.get('bikes')).toBe('3')
    expect(out.get('nearby')).toBe('open')
  })

  it('round-trips arbitrary filter values', () => {
    const originals: import('./map-filters').MapFilters[] = [
      { minBikes: 0, corridor: null },
      { minBikes: 1, corridor: null },
      { minBikes: 3, corridor: null },
      { minBikes: 5, corridor: 'waterfront' },
      { minBikes: 0, corridor: 'eastside' },
      { minBikes: 1, corridor: 'state_street' },
    ]
    for (const f of originals) {
      const written = writeFiltersToSearch(new URLSearchParams(), f)
      const read = readFiltersFromSearch(written)
      expect(read).toEqual(f)
    }
  })

  it('clears bikes key when written with defaults', () => {
    const out = writeFiltersToSearch(
      new URLSearchParams('bikes=3&nearby=open'),
      DEFAULT_FILTERS,
    )
    expect(out.get('bikes')).toBeNull()
    expect(out.get('nearby')).toBe('open')
  })
})

describe('hasActiveFilter', () => {
  it('is false for defaults', () => {
    expect(hasActiveFilter(DEFAULT_FILTERS)).toBe(false)
  })

  it('is true when any filter is active', () => {
    expect(hasActiveFilter({ minBikes: 1, corridor: null })).toBe(true)
    expect(hasActiveFilter({ minBikes: 5, corridor: null })).toBe(true)
    expect(hasActiveFilter({ minBikes: 0, corridor: 'waterfront' })).toBe(true)
  })
})
