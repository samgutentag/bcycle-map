import { describe, it, expect } from 'vitest'
import { formatRelative } from './relative-time'

describe('formatRelative', () => {
  const now = 1_000_000

  it('returns "just now" for <10s gaps', () => {
    expect(formatRelative(now - 0, now)).toBe('just now')
    expect(formatRelative(now - 9, now)).toBe('just now')
  })

  it('returns seconds for <60s gaps', () => {
    expect(formatRelative(now - 30, now)).toBe('30s ago')
    expect(formatRelative(now - 59, now)).toBe('59s ago')
  })

  it('returns minutes for <1h gaps', () => {
    expect(formatRelative(now - 60, now)).toBe('1m ago')
    expect(formatRelative(now - 600, now)).toBe('10m ago')
    expect(formatRelative(now - 3599, now)).toBe('59m ago')
  })

  it('returns hours for <1d gaps', () => {
    expect(formatRelative(now - 3600, now)).toBe('1h ago')
    expect(formatRelative(now - 7200, now)).toBe('2h ago')
    expect(formatRelative(now - 86399, now)).toBe('23h ago')
  })

  it('returns days for ≥1d gaps', () => {
    expect(formatRelative(now - 86400, now)).toBe('1d ago')
    expect(formatRelative(now - 86400 * 3, now)).toBe('3d ago')
  })

  it('handles future timestamps gracefully (clock drift)', () => {
    expect(formatRelative(now + 30, now)).toBe('just now')
  })
})
