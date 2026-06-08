import { describe, it, expect } from 'vitest'
import { deriveDirectionalCorridors, corridorsFromRegions, type CorridorStation } from './corridors'

const st = (id: string, lat: number, lon: number): CorridorStation => ({ station_id: id, name: id, lat, lon })

describe('deriveDirectionalCorridors', () => {
  it('returns an empty artifact for no stations', () => {
    const out = deriveDirectionalCorridors([])
    expect(out.corridors).toEqual([])
    expect(out.assignments).toEqual({})
  })

  it('labels stations by compass sector around the centroid, plus a central core', () => {
    const stations = [
      st('n', 1.0, 0.0),
      st('e', 0.0, 1.0),
      st('s', -1.0, 0.0),
      st('w', 0.0, -1.0),
      st('c', 0.001, 0.001),
    ]
    const out = deriveDirectionalCorridors(stations)
    expect(out.assignments['n']).toBe('north')
    expect(out.assignments['e']).toBe('east')
    expect(out.assignments['s']).toBe('south')
    expect(out.assignments['w']).toBe('west')
    expect(out.assignments['c']).toBe('central')
    expect(out.corridors.map(c => c.id)).toEqual(['north', 'east', 'south', 'west', 'central'])
    expect(out.corridors.find(c => c.id === 'north')!.label).toBe('North')
  })

  it('is deterministic for the same input', () => {
    const stations = [st('a', 0.5, 0.5), st('b', -0.5, -0.5)]
    expect(deriveDirectionalCorridors(stations)).toEqual(deriveDirectionalCorridors(stations))
  })
})

describe('corridorsFromRegions', () => {
  const regions = [
    { region_id: 'r9', region_name: 'Central Business District' },
    { region_id: 'r66', region_name: 'Clifton' },
  ]

  it('maps each station to its region by region_id and labels with region_name', () => {
    const stations: CorridorStation[] = [
      { station_id: 'a', name: 'A', lat: 39.1, lon: -84.5, region_id: 'r9' },
      { station_id: 'b', name: 'B', lat: 39.13, lon: -84.51, region_id: 'r66' },
    ]
    const out = corridorsFromRegions(stations, regions)
    expect(out).not.toBeNull()
    expect(out!.assignments).toEqual({ a: 'r9', b: 'r66' })
    expect(out!.corridors).toEqual([
      { id: 'r9', label: 'Central Business District' },
      { id: 'r66', label: 'Clifton' },
    ])
  })

  it('only emits corridors that have at least one assigned station, in region order', () => {
    const stations: CorridorStation[] = [
      { station_id: 'a', name: 'A', lat: 39.1, lon: -84.5, region_id: 'r66' },
    ]
    const out = corridorsFromRegions(stations, regions)
    expect(out!.corridors).toEqual([{ id: 'r66', label: 'Clifton' }])
  })

  it('returns null when no station carries a usable region_id (the SB case)', () => {
    const stations: CorridorStation[] = [
      { station_id: 'a', name: 'A', lat: 34.42, lon: -119.7 },
      { station_id: 'b', name: 'B', lat: 34.42, lon: -119.7, region_id: 'r-unknown' },
    ]
    expect(corridorsFromRegions(stations, regions)).toBeNull()
  })

  it('returns null when the regions list is empty', () => {
    expect(corridorsFromRegions([{ station_id: 'a', name: 'A', lat: 1, lon: 1, region_id: 'r9' }], [])).toBeNull()
  })
})
