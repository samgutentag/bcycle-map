import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import SystemBikesOverTime from './SystemBikesOverTime'

const data = [
  { snapshot_ts: 1778716800, total_bikes: 100, total_docks: 200 },
  { snapshot_ts: 1778716800 + 120, total_bikes: 95, total_docks: 205 },
  { snapshot_ts: 1778716800 + 240, total_bikes: 110, total_docks: 190 },
]

describe('SystemBikesOverTime', () => {
  it('renders two polylines (bikes + docks)', () => {
    const { container } = render(<SystemBikesOverTime data={data} />)
    const svg = container.querySelector('svg')
    const polylines = container.querySelectorAll('polyline')
    expect(svg).toBeInTheDocument()
    expect(polylines.length).toBe(2)
    for (const p of polylines) {
      expect(p.getAttribute('points')?.split(' ').length).toBe(3)
    }
  })

  it('renders an empty-state message for zero rows', () => {
    const { container } = render(<SystemBikesOverTime data={[]} />)
    expect(container.textContent).toMatch(/not enough data/i)
  })

  it('renders y-axis with shared scale spanning both series', () => {
    const { container } = render(<SystemBikesOverTime data={data} />)
    // yMax is the largest value across both series (205 from docks)
    expect(container.textContent).toContain('205')
  })

  it('renders a legend with latest values for each series', () => {
    const { container } = render(<SystemBikesOverTime data={data} />)
    expect(container.textContent).toMatch(/Bikes available/i)
    expect(container.textContent).toMatch(/Open docks/i)
    expect(container.textContent).toContain('latest 110')  // last bikes
    expect(container.textContent).toContain('latest 190')  // last docks
  })
})
