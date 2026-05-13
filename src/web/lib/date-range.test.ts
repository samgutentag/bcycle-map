import { describe, it, expect } from 'vitest'
import { resolveRange, type Preset } from './date-range'

const now = 1778692030  // 2026-05-13 14:13:50 UTC (approx)

describe('resolveRange', () => {
  it('returns last 24 hours for "24h"', () => {
    const r = resolveRange('24h', now)
    expect(r.toTs).toBe(now)
    expect(r.fromTs).toBe(now - 24 * 3600)
  })

  it('returns last 7 days for "7d"', () => {
    const r = resolveRange('7d', now)
    expect(r.toTs).toBe(now)
    expect(r.fromTs).toBe(now - 7 * 86400)
  })

  it('returns last 30 days for "30d"', () => {
    const r = resolveRange('30d', now)
    expect(r.fromTs).toBe(now - 30 * 86400)
  })

  it('returns project start to now for "all"', () => {
    const r = resolveRange('all', now)
    expect(r.toTs).toBe(now)
    expect(r.fromTs).toBeLessThan(now)
    expect(r.fromTs).toBeGreaterThanOrEqual(1778626800)
  })

  it('lists every preset', () => {
    const presets: Preset[] = ['24h', '7d', '30d', 'all']
    for (const p of presets) {
      expect(() => resolveRange(p, now)).not.toThrow()
    }
  })
})
