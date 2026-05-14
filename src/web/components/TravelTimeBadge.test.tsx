import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import TravelTimeBadge from './TravelTimeBadge'

describe('TravelTimeBadge', () => {
  it('shows a loading state when loading is true', () => {
    render(<TravelTimeBadge loading />)
    expect(screen.getByText(/estimating bike time/i)).toBeInTheDocument()
  })

  it('renders minutes and miles when both values are provided', () => {
    render(<TravelTimeBadge minutes={12} meters={3219} />)
    expect(screen.getByText(/12 min bike ride/i)).toBeInTheDocument()
    expect(screen.getByText(/2\.0 mi/i)).toBeInTheDocument()
  })

  it('shows feet when the distance is under a tenth of a mile', () => {
    render(<TravelTimeBadge minutes={1} meters={120} />)
    // 120 m ≈ 394 ft
    expect(screen.getByText(/\d{2,3} ft/i)).toBeInTheDocument()
  })

  it('shows whole-mile for long rides', () => {
    render(<TravelTimeBadge minutes={60} meters={20000} />)
    // 20 km ≈ 12.4 mi, rounded to 12
    expect(screen.getByText(/12 mi/i)).toBeInTheDocument()
  })

  it('renders departure and arrival clock times when departureTimeSec is provided', () => {
    // Use a fixed UTC departure timestamp and verify both clock labels appear
    const departure = 1700000000  // arbitrary fixed timestamp
    render(<TravelTimeBadge minutes={12} meters={3000} departureTimeSec={departure} />)
    expect(screen.getByText(/Leave .+ → arrive .+/i)).toBeInTheDocument()
  })

  it('shows "unknown" when minutes and meters are null', () => {
    render(<TravelTimeBadge minutes={null} meters={null} />)
    expect(screen.getByText(/travel time unknown/i)).toBeInTheDocument()
  })

  it('shows "unknown" when only one value is provided', () => {
    render(<TravelTimeBadge minutes={12} meters={null} />)
    expect(screen.getByText(/travel time unknown/i)).toBeInTheDocument()
  })

  it('shows "<1" when the ride is under a minute', () => {
    render(<TravelTimeBadge minutes={0.4} meters={200} />)
    expect(screen.getByText(/<1 min bike ride/i)).toBeInTheDocument()
  })
})
