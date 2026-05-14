import { describe, it, expect } from 'vitest'
import { normalizePath } from './path-patterns'

describe('normalizePath', () => {
  it('collapses station detail paths', () => {
    expect(normalizePath('/station/bcycle_santabarbara_4852/details')).toBe('/station/:id/details')
    expect(normalizePath('/station/bcycle_x_99/details')).toBe('/station/:id/details')
  })

  it('collapses bare station paths', () => {
    expect(normalizePath('/station/abc123')).toBe('/station/:id')
  })

  it('collapses route pair paths', () => {
    expect(normalizePath('/route/abc/def')).toBe('/route/:from/:to')
  })

  it('collapses single-station route paths', () => {
    expect(normalizePath('/route/abc')).toBe('/route/:from')
  })

  it('passes known routes through unchanged', () => {
    expect(normalizePath('/')).toBe('/')
    expect(normalizePath('/explore')).toBe('/explore')
    expect(normalizePath('/activity')).toBe('/activity')
    expect(normalizePath('/route')).toBe('/route')
    expect(normalizePath('/insights')).toBe('/insights')
  })

  it('strips query strings and hashes before matching', () => {
    expect(normalizePath('/station/abc/details?foo=bar')).toBe('/station/:id/details')
    expect(normalizePath('/explore#section')).toBe('/explore')
  })

  it('returns (other) for unknown paths', () => {
    expect(normalizePath('/random/path')).toBe('(other)')
    expect(normalizePath('/admin')).toBe('(other)')
  })

  it('tolerates trailing slashes', () => {
    expect(normalizePath('/explore/')).toBe('/explore')
    expect(normalizePath('/station/abc/details/')).toBe('/station/:id/details')
  })
})
