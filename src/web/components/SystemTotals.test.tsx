import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import SystemTotals, { computeTotals } from './SystemTotals'
import type { StationSnapshot } from '@shared/types'

const make = (overrides: Partial<StationSnapshot> = {}): StationSnapshot => ({
  station_id: 'a',
  name: 'A',
  lat: 0,
  lon: 0,
  num_bikes_available: 3,
  num_docks_available: 7,
  bikes_electric: 3,
  bikes_classic: 0,
  bikes_smart: 0,
  is_installed: true,
  is_renting: true,
  is_returning: true,
  last_reported: 0,
  ...overrides,
})

describe('computeTotals', () => {
  it('sums bikes and docks across stations', () => {
    const t = computeTotals([
      make({ num_bikes_available: 2, num_docks_available: 8 }),
      make({ num_bikes_available: 5, num_docks_available: 3 }),
    ])
    expect(t.bikes).toBe(7)
    expect(t.docks).toBe(11)
  })

  it('counts stations as online only when both is_installed and is_renting', () => {
    const t = computeTotals([
      make(),
      make({ is_renting: false }),
      make({ is_installed: false }),
    ])
    expect(t.stationsOnline).toBe(1)
  })

  it('returns zeros for empty input', () => {
    const t = computeTotals([])
    expect(t).toEqual({ bikes: 0, docks: 0, stationsOnline: 0, totalDockSlots: 0 })
  })

  it('derives totalDockSlots as bikes + docks', () => {
    const t = computeTotals([
      make({ num_bikes_available: 3, num_docks_available: 7 }),
      make({ num_bikes_available: 5, num_docks_available: 4 }),
    ])
    expect(t.totalDockSlots).toBe(19)
  })
})

describe('SystemTotals', () => {
  it('renders bikes and docks with a shared total-capacity denominator', () => {
    const { container } = render(<SystemTotals stations={[
      make({ num_bikes_available: 4, num_docks_available: 6 }),
      make({ num_bikes_available: 1, num_docks_available: 9 }),
    ]} />)
    // Totals: bikes=5, docks=15, total dock slots = 20
    expect(container.textContent).toContain('5')
    expect(container.textContent).toContain('15')
    // The "/ 20" denominator should appear on both rows
    const denominators = container.textContent?.match(/\/ 20/g) ?? []
    expect(denominators.length).toBe(2)
  })

  it('renders utilization percentage', () => {
    render(<SystemTotals stations={[
      make({ num_bikes_available: 5, num_docks_available: 5 }),
    ]} />)
    expect(screen.getByText(/50% full/)).toBeInTheDocument()
  })

  it('shows stations-online ratio', () => {
    render(<SystemTotals stations={[
      make(),
      make({ is_renting: false }),
    ]} />)
    expect(screen.getByText(/1 \/ 2 stations online/)).toBeInTheDocument()
  })
})
