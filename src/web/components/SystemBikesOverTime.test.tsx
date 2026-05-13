import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import SystemBikesOverTime from './SystemBikesOverTime'

const data = [
  { snapshot_ts: 1778716800, total_bikes: 100 },
  { snapshot_ts: 1778716800 + 120, total_bikes: 95 },
  { snapshot_ts: 1778716800 + 240, total_bikes: 110 },
]

describe('SystemBikesOverTime', () => {
  it('renders an SVG with a polyline', () => {
    const { container } = render(<SystemBikesOverTime data={data} />)
    const svg = container.querySelector('svg')
    const polyline = container.querySelector('polyline')
    expect(svg).toBeInTheDocument()
    expect(polyline).toBeInTheDocument()
    expect(polyline?.getAttribute('points')?.split(' ').length).toBe(3)
  })

  it('renders an empty-state message for zero rows', () => {
    const { container } = render(<SystemBikesOverTime data={[]} />)
    expect(container.textContent).toMatch(/not enough data/i)
  })

  it('renders y-axis min and max labels', () => {
    const { container } = render(<SystemBikesOverTime data={data} />)
    expect(container.textContent).toContain('110')
    expect(container.textContent).toContain('95')
  })
})
