import { describe, it, expect } from 'vitest'
import {
  assignCorridor,
  buildCorridorMap,
  CORRIDOR_LABELS,
  CORRIDOR_ORDER,
  isCorridorId,
  type CorridorId,
} from './legacy-corridors'
import type { StationSnapshot } from '@shared/types'

const make = (overrides: Partial<StationSnapshot> = {}): StationSnapshot => ({
  station_id: 'x',
  name: '',
  lat: 34.42,
  lon: -119.70,
  num_bikes_available: 0,
  num_docks_available: 0,
  bikes_electric: 0,
  bikes_classic: 0,
  bikes_smart: 0,
  is_installed: true,
  is_renting: true,
  is_returning: true,
  last_reported: 0,
  ...overrides,
})

describe('CORRIDOR_LABELS / CORRIDOR_ORDER integrity', () => {
  it('every CORRIDOR_ORDER id has a label', () => {
    for (const id of CORRIDOR_ORDER) {
      expect(CORRIDOR_LABELS[id]).toBeTruthy()
    }
  })

  it('every label corresponds to an id in CORRIDOR_ORDER', () => {
    for (const id of Object.keys(CORRIDOR_LABELS)) {
      expect(CORRIDOR_ORDER).toContain(id as CorridorId)
    }
  })
})

describe('isCorridorId', () => {
  it('returns true for known ids', () => {
    for (const id of CORRIDOR_ORDER) {
      expect(isCorridorId(id)).toBe(true)
    }
  })

  it('returns false for unknown strings', () => {
    expect(isCorridorId('not-a-corridor')).toBe(false)
    expect(isCorridorId('')).toBe(false)
    expect(isCorridorId('WATERFRONT')).toBe(false)
  })
})

describe('assignCorridor — representative stations', () => {
  // Each row picks a real station from the live SB BCycle list (per the
  // /current snapshot) and pins its expected corridor.
  const cases: Array<[string, Partial<StationSnapshot>, CorridorId]> = [
    ['Harbor Walk',                      { name: 'Harbor Walk',                            lat: 34.4037, lon: -119.6930 }, 'waterfront'],
    ['Leadbetter Beach',                 { name: 'Leadbetter Beach',                       lat: 34.4027, lon: -119.6974 }, 'waterfront'],
    ['Cliff and Oceano',                 { name: 'Cliff and Oceano',                       lat: 34.4044, lon: -119.7054 }, 'waterfront'],
    ['Cabrillo and Chapala',             { name: 'Cabrillo and Chapala',                   lat: 34.4113, lon: -119.6900 }, 'cabrillo'],
    ['Cabrillo and Bath - Mountainside', { name: 'Cabrillo and Bath - Mountainside',       lat: 34.4094, lon: -119.6927 }, 'cabrillo'],
    ['Garden and Cabrillo',              { name: 'Garden and Cabrillo',                    lat: 34.4144, lon: -119.6870 }, 'cabrillo'],
    ['Amtrak @ State St.',               { name: 'Amtrak @ State St.',                     lat: 34.4137, lon: -119.6922 }, 'cabrillo'],
    ['East Carrillo & State Street',     { name: 'East Carrillo & State Street (1000 Block)', lat: 34.4217, lon: -119.7021 }, 'state_street'],
    ['MTD Transit Center @ Chapala',     { name: 'MTD Transit Center @ Chapala',           lat: 34.4213, lon: -119.7036 }, 'state_street'],
    ['State & Valerio St',               { name: 'State & Valerio St',                     lat: 34.4281, lon: -119.7112 }, 'state_street'],
    ['De La Vina & Islay',               { name: 'De La Vina & Islay',                     lat: 34.4267, lon: -119.7143 }, 'de_la_vina'],
    ['Gutierrez & Cesar Chavez',         { name: 'Gutierrez & Cesar Chavez',               lat: 34.4219, lon: -119.6871 }, 'funk_zone'],
    ['Smart & Final',                    { name: 'Smart & Final',                          lat: 34.4184, lon: -119.6916 }, 'funk_zone'],
    ['Milpas & De La Guerra St',         { name: 'Milpas & De La Guerra St',               lat: 34.4292, lon: -119.6890 }, 'eastside'],
    ['Eastside Library',                 { name: 'Eastside Library',                       lat: 34.4267, lon: -119.6802 }, 'eastside'],
    ['San Andres & Cook',                { name: 'San Andres & Cook - 99 cent store',      lat: 34.4192, lon: -119.7168 }, 'mesa'],
    ['SBCC Schott Campus',               { name: 'SBCC Schott Campus',                     lat: 34.4282, lon: -119.7200 }, 'mesa'],
    ['Las Positas Rd',                   { name: 'Las Positas Rd @ Richelle Lane',         lat: 34.4166, lon: -119.7409 }, 'mesa'],
    ['Natural History Museum',           { name: 'Natural History Museum',                 lat: 34.4414, lon: -119.7145 }, 'upper_state'],
    ['Chapala & Mission',                { name: 'Chapala & Mission',                      lat: 34.4297, lon: -119.7157 }, 'upper_east'],
    ['Fran Apartments',                  { name: 'Fran Apartments',                        lat: 34.4292, lon: -119.7267 }, 'upper_east'],
    ['Chapala & Arrellaga St.',          { name: 'Chapala & Arrellaga St.',                lat: 34.4258, lon: -119.7107 }, 'upper_east'],
    ['La Cumbre Animal Hospital',        { name: 'La Cumbre Animal Hospital',              lat: 34.4406, lon: -119.7523 }, 'upper_state'],
    ['Coast Village Road @ Chevron',     { name: 'Coast Village Road @ Chevron',           lat: 34.4212, lon: -119.6479 }, 'montecito'],
    ['Montecito & Soledad',              { name: 'Montecito & Soledad',                    lat: 34.4275, lon: -119.6794 }, 'montecito'],
  ]

  for (const [label, props, expected] of cases) {
    it(`${label} → ${expected}`, () => {
      expect(assignCorridor(make(props))).toBe(expected)
    })
  }
})

describe('assignCorridor — edge cases', () => {
  it('returns null when no rule matches', () => {
    // South of the city, no name match, outside every lat-based rule.
    expect(assignCorridor(make({ name: 'Some Faraway Spot', lat: 33.0, lon: -118.0 }))).toBeNull()
  })

  it('is case-insensitive on station names', () => {
    expect(assignCorridor(make({ name: 'HARBOR WALK', lat: 34.4037, lon: -119.6930 }))).toBe('waterfront')
    expect(assignCorridor(make({ name: 'MILPAS AND COTA', lat: 34.4270, lon: -119.6868 }))).toBe('eastside')
  })
})

describe('buildCorridorMap', () => {
  it('returns a Map keyed by station_id with the assigned corridor', () => {
    const stations = [
      make({ station_id: 'a', name: 'Harbor Walk',         lat: 34.4037, lon: -119.6930 }),
      make({ station_id: 'b', name: 'Milpas & De La Guerra St', lat: 34.4292, lon: -119.6890 }),
      make({ station_id: 'c', name: 'Some Faraway Spot',   lat: 33.0,    lon: -118.0 }),
    ]
    const m = buildCorridorMap(stations)
    expect(m.get('a')).toBe('waterfront')
    expect(m.get('b')).toBe('eastside')
    // 'c' has no assignment and is intentionally omitted
    expect(m.has('c')).toBe(false)
    expect(m.size).toBe(2)
  })

  it('returns an empty Map for empty input', () => {
    expect(buildCorridorMap([]).size).toBe(0)
  })
})
