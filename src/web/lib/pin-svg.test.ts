import { describe, it, expect } from 'vitest'
import { buildPinSVG, pinSize, buildEndpointPin } from './pin-svg'

describe('buildPinSVG', () => {
  it('returns an SVG with the teardrop outline', () => {
    const svg = buildPinSVG(3, 8)
    expect(svg).toMatch(/^<svg /)
    expect(svg).toContain('M 18 47')
  })

  it('renders bikes-available on top and open-docks on bottom', () => {
    const svg = buildPinSVG(3, 8)
    expect(svg).toContain('>3<')
    expect(svg).toContain('>8<')
  })

  it('renders a visible separator line between the numbers', () => {
    const svg = buildPinSVG(3, 8)
    expect(svg).toContain('<line')
    expect(svg).toContain('stroke="white"')
  })

  it('shrinks the font size when either value reaches 3 digits', () => {
    const small = buildPinSVG(99, 99)
    const big = buildPinSVG(150, 8)
    expect(small).toContain('font-size="12"')
    expect(big).toContain('font-size="10"')
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

describe('buildEndpointPin', () => {
  it('renders an origin pin with the emerald fill', () => {
    const svg = buildEndpointPin('origin')
    expect(svg).toContain('<svg')
    expect(svg.toLowerCase()).toContain('#10b981') // emerald-500
  })

  it('renders a destination pin with a red fill', () => {
    const svg = buildEndpointPin('destination')
    expect(svg).toContain('<svg')
    expect(svg.toLowerCase()).toContain('#dc2626') // red-600
  })

  it('renders a via pin with reduced opacity', () => {
    const svg = buildEndpointPin('via')
    expect(svg).toContain('opacity="0.35"')
  })
})
