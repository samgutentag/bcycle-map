import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import AvgTripDurationBadge from './AvgTripDurationBadge'

describe('AvgTripDurationBadge', () => {
  it('renders the avg minutes and sample count when count >= 3', () => {
    render(<AvgTripDurationBadge count={5} meanSec={420} />)
    expect(screen.getByText(/avg 7 min/i)).toBeInTheDocument()
    expect(screen.getByText(/over 5 trips/i)).toBeInTheDocument()
  })

  it('renders nothing when count is below the minimum sample threshold', () => {
    const { container } = render(<AvgTripDurationBadge count={2} meanSec={500} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when count is zero', () => {
    const { container } = render(<AvgTripDurationBadge count={0} meanSec={0} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when null inputs are provided', () => {
    const { container } = render(<AvgTripDurationBadge count={null} meanSec={null} />)
    expect(container.firstChild).toBeNull()
  })
})
