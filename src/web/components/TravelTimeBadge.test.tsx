import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import TravelTimeBadge from './TravelTimeBadge'

describe('TravelTimeBadge', () => {
  it('shows a loading state when loading is true', () => {
    render(<TravelTimeBadge loading />)
    expect(screen.getByText(/estimating bike time/i)).toBeInTheDocument()
  })

  it('renders minutes and km when both values are provided', () => {
    render(<TravelTimeBadge minutes={12} meters={2300} />)
    expect(screen.getByText(/12 min bike ride/i)).toBeInTheDocument()
    expect(screen.getByText(/2\.3 km/i)).toBeInTheDocument()
  })

  it('shows meters when the distance is under a kilometer', () => {
    render(<TravelTimeBadge minutes={3} meters={400} />)
    expect(screen.getByText(/400 m/i)).toBeInTheDocument()
  })

  it('shows whole-km for long rides', () => {
    render(<TravelTimeBadge minutes={45} meters={12500} />)
    expect(screen.getByText(/13 km/i)).toBeInTheDocument()
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
