import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import HourOfWeekHeatmap from './HourOfWeekHeatmap'

const data = [
  { dow: 0, hod: 0, avg_bikes: 5, samples: 10 },
  { dow: 0, hod: 1, avg_bikes: 7, samples: 10 },
  { dow: 3, hod: 12, avg_bikes: 2, samples: 10 },
]

describe('HourOfWeekHeatmap', () => {
  it('renders a 7x24 grid (168 cells) in the SVG', () => {
    const { container } = render(<HourOfWeekHeatmap data={data} />)
    const cells = container.querySelectorAll('rect.cell')
    expect(cells.length).toBe(7 * 24)
  })

  it('renders day-of-week labels', () => {
    const { container } = render(<HourOfWeekHeatmap data={data} />)
    expect(container.textContent).toContain('Sun')
    expect(container.textContent).toContain('Sat')
  })

  it('renders empty-state for zero rows', () => {
    const { container } = render(<HourOfWeekHeatmap data={[]} />)
    expect(container.textContent).toMatch(/no data/i)
  })
})
