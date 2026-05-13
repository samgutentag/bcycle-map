import { describe, it, expect } from 'vitest'
import { buildPinSVG, pinSize } from './pin-svg'

describe('buildPinSVG', () => {
  it('returns an SVG string with the teardrop outline path', () => {
    const svg = buildPinSVG(3, 7)
    expect(svg).toMatch(/^<svg /)
    expect(svg).toContain('M 14 34')
  })

  it('renders an all-empty marker as a single gray circle (no pie path)', () => {
    const svg = buildPinSVG(0, 5)
    expect(svg).toMatch(/<circle cx="14" cy="14" r="8" fill="#9ca3af"\/>/)
    expect(svg).not.toContain('<path d="M 14 14')
  })

  it('renders an all-bikes marker as a single green circle (no pie path)', () => {
    const svg = buildPinSVG(5, 0)
    expect(svg).toMatch(/<circle cx="14" cy="14" r="8" fill="#15803d"\/>/)
    expect(svg).not.toContain('<path d="M 14 14')
  })

  it('renders a partial-fill marker as a gray background + green slice', () => {
    const svg = buildPinSVG(3, 7)
    expect(svg).toContain('fill="#9ca3af"')
    expect(svg).toContain('fill="#15803d"')
    expect(svg).toContain('<path d="M 14 14')
  })

  it('uses large-arc-flag = 1 when bikes > 50% of capacity', () => {
    const svg = buildPinSVG(7, 3)
    expect(svg).toMatch(/A 8 8 0 1 1/)
  })

  it('uses large-arc-flag = 0 when bikes <= 50% of capacity', () => {
    const svg = buildPinSVG(3, 7)
    expect(svg).toMatch(/A 8 8 0 0 1/)
  })

  it('handles zero capacity stations without throwing', () => {
    expect(() => buildPinSVG(0, 0)).not.toThrow()
    const svg = buildPinSVG(0, 0)
    expect(svg).toContain('fill="#9ca3af"')
  })
})

describe('pinSize', () => {
  it('returns 24px minimum width', () => {
    expect(pinSize(0).width).toBe(24)
  })

  it('returns 40px maximum width', () => {
    expect(pinSize(100).width).toBe(40)
  })

  it('scales between min and max', () => {
    const s10 = pinSize(10)
    expect(s10.width).toBeGreaterThan(24)
    expect(s10.width).toBeLessThan(40)
  })

  it('maintains the 28:36 aspect ratio', () => {
    const s = pinSize(10)
    expect(s.height / s.width).toBeCloseTo(36 / 28, 5)
  })
})
