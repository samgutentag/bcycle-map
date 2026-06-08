import { describe, it, expect } from 'vitest'
import { deriveDirectionalCorridors, type CorridorStation } from './corridors'

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
