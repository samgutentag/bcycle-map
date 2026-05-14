import { describe, it, expect } from 'vitest'
import { buildPinSVG, pinSize } from './pin-svg'

describe('buildPinSVG', () => {
  it('returns an SVG with the teardrop outline', () => {
    const svg = buildPinSVG(3, 8)
    expect(svg).toMatch(/^<svg /)
    expect(svg).toContain('M 18 47')
  })

  it('renders both the top and bottom numbers', () => {
    const svg = buildPinSVG(3, 8)
    expect(svg).toContain('>3<')
    expect(svg).toContain('>8<')
  })

  it('shrinks the top font size for 3-digit values', () => {
    const small = buildPinSVG(99, 100)
    const big = buildPinSVG(150, 200)
    expect(small).toContain('font-size="14"')
    expect(big).toContain('font-size="11"')
  })

  it('uses the offline color when opts.offline is true', () => {
    const online = buildPinSVG(3, 8)
    const offline = buildPinSVG(3, 8, { offline: true })
    expect(online).toContain('#0d6cb0')
    expect(offline).toContain('#9ca3af')
  })
})

describe('pinSize', () => {
  it('clamps to a 30px minimum width', () => {
    expect(pinSize(0).width).toBe(30)
  })

  it('clamps to a 42px maximum width', () => {
    expect(pinSize(1000).width).toBe(42)
  })

  it('scales between min and max', () => {
    const s10 = pinSize(10)
    expect(s10.width).toBeGreaterThan(30)
    expect(s10.width).toBeLessThan(42)
  })

  it('maintains the 36:48 aspect ratio', () => {
    const s = pinSize(10)
    expect(s.height / s.width).toBeCloseTo(48 / 36, 5)
  })
})
