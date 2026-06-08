import { describe, it, expect } from 'vitest'
import { corridorOrder, corridorLabels, assignmentMap, isCorridorIn } from './corridors'
import type { CorridorArtifact } from '@shared/corridors'

const ART: CorridorArtifact = {
  generated_at: 1,
  source: 'regions',
  corridors: [{ id: 'r9', label: 'CBD' }, { id: 'r66', label: 'Clifton' }],
  assignments: { a: 'r9', b: 'r66' },
}

describe('artifact-driven corridor helpers', () => {
  it('corridorOrder returns ids in artifact order', () => {
    expect(corridorOrder(ART)).toEqual(['r9', 'r66'])
    expect(corridorOrder(null)).toEqual([])
  })
  it('corridorLabels maps id -> label', () => {
    expect(corridorLabels(ART)).toEqual({ r9: 'CBD', r66: 'Clifton' })
    expect(corridorLabels(null)).toEqual({})
  })
  it('assignmentMap returns a Map of station_id -> corridor id', () => {
    const m = assignmentMap(ART)
    expect(m.get('a')).toBe('r9')
    expect(m.get('b')).toBe('r66')
    expect(assignmentMap(null).size).toBe(0)
  })
  it('isCorridorIn checks membership in the artifact', () => {
    expect(isCorridorIn(ART, 'r9')).toBe(true)
    expect(isCorridorIn(ART, 'nope')).toBe(false)
    expect(isCorridorIn(null, 'r9')).toBe(false)
  })
})
