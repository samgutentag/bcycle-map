import { describe, it, expect } from 'vitest'
import { lookupPairStat, type Popularity, type PairStat } from './popularity'

const STAT_A_B: PairStat = { count: 7, mean_sec: 420 }

const POP: Popularity = {
  computedAt: 1_700_000_000,
  windowStartTs: 1_697_400_000,
  windowEndTs: 1_700_000_000,
  topStations: [{ station_id: 's1', count: 50 }],
  topRoutes: [{ from_station_id: 's1', to_station_id: 's2', count: 7 }],
  pairStats: { s1: { s2: STAT_A_B } },
}

describe('lookupPairStat', () => {
  it('returns the stat when it exists', () => {
    expect(lookupPairStat(POP, 's1', 's2')).toBe(STAT_A_B)
  })

  it('returns null when the reverse direction is missing', () => {
    expect(lookupPairStat(POP, 's2', 's1')).toBeNull()
  })

  it('returns null when either id is unknown or popularity is null', () => {
    expect(lookupPairStat(POP, 's1', 'sX')).toBeNull()
    expect(lookupPairStat(POP, 'sX', 's2')).toBeNull()
    expect(lookupPairStat(null, 's1', 's2')).toBeNull()
    expect(lookupPairStat(POP, null, 's2')).toBeNull()
    expect(lookupPairStat(POP, 's1', undefined)).toBeNull()
  })
})
