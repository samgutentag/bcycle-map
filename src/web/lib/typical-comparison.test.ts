import { describe, it, expect } from 'vitest'
import {
  classifyTypical,
  ringToneFor,
  MIN_DAYS_FOR_COMPARISON,
  type TypicalProfile,
} from './typical-comparison'

function makeProfile(opts: {
  daysCovered: number
  currentHour?: number
  typicalAtHour?: number
  samplesAtHour?: number
}): TypicalProfile {
  const currentHour = opts.currentHour ?? 12
  const hours = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    bikes: h === currentHour ? (opts.typicalAtHour ?? 0) : 0,
    docks: 0,
    samples: h === currentHour ? (opts.samplesAtHour ?? (opts.typicalAtHour ? 5 : 0)) : 0,
  }))
  return {
    stationId: 'test',
    hours,
    currentHour,
    currentDow: 3,
    daysCovered: opts.daysCovered,
    isDowFiltered: opts.daysCovered >= 21,
    label: 'Typical Wednesday',
    timezone: 'America/Los_Angeles',
  }
}

describe('classifyTypical', () => {
  describe('gating', () => {
    it('returns unavailable when no profile is provided', () => {
      const c = classifyTypical(5, null)
      expect(c.verdict).toBe('unavailable')
      expect(c.typical).toBeNull()
      expect(c.daysCovered).toBeNull()
    })

    it('returns insufficient-data when fewer than 3 days covered', () => {
      const profile = makeProfile({ daysCovered: 2, typicalAtHour: 8 })
      const c = classifyTypical(5, profile)
      expect(c.verdict).toBe('insufficient-data')
      expect(c.typical).toBeNull()
      expect(c.daysCovered).toBe(2)
    })

    it('exposes MIN_DAYS_FOR_COMPARISON as 3', () => {
      expect(MIN_DAYS_FOR_COMPARISON).toBe(3)
    })

    it('starts producing verdicts at exactly 3 days covered', () => {
      const profile = makeProfile({ daysCovered: 3, typicalAtHour: 6 })
      const c = classifyTypical(6, profile)
      expect(c.verdict).not.toBe('insufficient-data')
    })

    it('returns no-baseline when the current-hour bucket has zero samples', () => {
      const profile = makeProfile({ daysCovered: 30, typicalAtHour: 0, samplesAtHour: 0 })
      const c = classifyTypical(5, profile)
      expect(c.verdict).toBe('no-baseline')
      expect(c.typical).toBeNull()
      expect(c.daysCovered).toBe(30)
    })

    it('returns no-baseline when the bucket reports samples but zero bikes', () => {
      // edge case: the station has been observed at this hour but never had
      // any bikes parked — can't divide by zero typical.
      const profile = makeProfile({ daysCovered: 30, typicalAtHour: 0, samplesAtHour: 10 })
      const c = classifyTypical(5, profile)
      expect(c.verdict).toBe('no-baseline')
    })
  })

  describe('more / fewer / average thresholds', () => {
    const profile = makeProfile({ daysCovered: 30, typicalAtHour: 10 })

    it('reports more when current >= 1.5x typical', () => {
      expect(classifyTypical(15, profile).verdict).toBe('more')
      expect(classifyTypical(20, profile).verdict).toBe('more')
    })

    it('reports fewer when current <= 0.5x typical', () => {
      expect(classifyTypical(5, profile).verdict).toBe('fewer')
      expect(classifyTypical(0, profile).verdict).toBe('fewer')
    })

    it('reports average inside the ±band', () => {
      expect(classifyTypical(10, profile).verdict).toBe('average')
      expect(classifyTypical(8, profile).verdict).toBe('average')
      expect(classifyTypical(14, profile).verdict).toBe('average')
    })

    it('returns the typical value alongside the verdict', () => {
      const c = classifyTypical(10, profile)
      expect(c.typical).toBe(10)
      expect(c.daysCovered).toBe(30)
    })

    it('respects the "typical - 3" floor for small stations', () => {
      // Typical 4 → 0.5x = 2. Without the minus-3 floor, currentBikes=1
      // would fall in the "average" band. With the floor, max(1, 4-3) = 1,
      // and currentBikes <= 1 should read as "fewer".
      const small = makeProfile({ daysCovered: 30, typicalAtHour: 4 })
      expect(classifyTypical(1, small).verdict).toBe('fewer')
    })

    it('treats current == typical as average', () => {
      expect(classifyTypical(10, profile).verdict).toBe('average')
    })
  })

  describe('regression: details-page wording inputs', () => {
    // These mirror the original inline conditions in StationDetails so the
    // visible callout text can't drift after the refactor. Same shape:
    //   typical 6.0, current 9 → more (9 >= 6*1.5=9)
    //   typical 6.0, current 3 → fewer (3 <= 6*0.5=3)
    //   typical 6.0, current 5 → average (between 3 and 9)
    it('matches the prior "more" boundary at exactly 1.5x', () => {
      const p = makeProfile({ daysCovered: 30, typicalAtHour: 6 })
      expect(classifyTypical(9, p).verdict).toBe('more')
    })

    it('matches the prior "fewer" boundary at exactly 0.5x', () => {
      const p = makeProfile({ daysCovered: 30, typicalAtHour: 6 })
      expect(classifyTypical(3, p).verdict).toBe('fewer')
    })

    it('reports average just inside both bounds', () => {
      const p = makeProfile({ daysCovered: 30, typicalAtHour: 6 })
      expect(classifyTypical(5, p).verdict).toBe('average')
    })
  })
})

describe('ringToneFor', () => {
  it('maps more → success and fewer → warning', () => {
    expect(ringToneFor('more')).toBe('success')
    expect(ringToneFor('fewer')).toBe('warning')
  })

  it('returns null for verdicts that should render no ring', () => {
    expect(ringToneFor('average')).toBeNull()
    expect(ringToneFor('no-baseline')).toBeNull()
    expect(ringToneFor('insufficient-data')).toBeNull()
    expect(ringToneFor('unavailable')).toBeNull()
  })
})
