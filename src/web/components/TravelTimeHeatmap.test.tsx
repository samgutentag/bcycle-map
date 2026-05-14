import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import TravelTimeHeatmap from './TravelTimeHeatmap'
import type { TravelMatrix } from '../hooks/useTravelMatrix'
import type { StationSnapshot } from '@shared/types'

const station = (id: string, name: string): StationSnapshot => ({
  station_id: id,
  name,
  lat: 0,
  lon: 0,
  num_bikes_available: 0,
  num_docks_available: 0,
  bikes_electric: 0,
  bikes_classic: 0,
  bikes_smart: 0,
  is_installed: true,
  is_renting: true,
  is_returning: true,
  last_reported: 0,
})

const STATIONS: StationSnapshot[] = [
  station('a', 'Anacapa St'),
  station('b', 'Bath St'),
  station('c', 'Cabrillo Blvd'),
]

const MATRIX: TravelMatrix = {
  computedAt: 0,
  stations: STATIONS.map(s => ({ id: s.station_id, lat: s.lat, lon: s.lon })),
  edges: {
    a: { b: { minutes: 4, meters: 1000 }, c: { minutes: 12, meters: 3000 } },
    b: { a: { minutes: 5, meters: 1100 }, c: { minutes: 9, meters: 2200 } },
    c: { a: { minutes: 11, meters: 2900 }, b: { minutes: 8, meters: 2100 } },
  },
}

describe('TravelTimeHeatmap', () => {
  it('renders an N×N grid of cells', () => {
    const { container } = render(
      <TravelTimeHeatmap matrix={MATRIX} stations={STATIONS} selectedStartId={null} selectedEndId={null} />,
    )
    // 3 stations → 9 cells
    expect(container.querySelectorAll('rect').length).toBe(9)
  })

  it('renders an origin row outline when a start is selected', () => {
    const { container } = render(
      <TravelTimeHeatmap matrix={MATRIX} stations={STATIONS} selectedStartId="b" selectedEndId={null} />,
    )
    // 9 cells + 1 row outline
    expect(container.querySelectorAll('rect').length).toBe(10)
  })

  it('renders both row + column + intersection when both are selected', () => {
    const { container } = render(
      <TravelTimeHeatmap matrix={MATRIX} stations={STATIONS} selectedStartId="a" selectedEndId="c" />,
    )
    // 9 cells + row + column + intersection = 12
    expect(container.querySelectorAll('rect').length).toBe(12)
  })

  it('does not render the intersection outline when start equals destination', () => {
    const { container } = render(
      <TravelTimeHeatmap matrix={MATRIX} stations={STATIONS} selectedStartId="a" selectedEndId="a" />,
    )
    // 9 cells + row outline + column outline (no intersection)
    expect(container.querySelectorAll('rect').length).toBe(11)
  })

  it('shows an empty-state message when no stations overlap', () => {
    const { container } = render(
      <TravelTimeHeatmap matrix={{ ...MATRIX, stations: [] }} stations={[]} selectedStartId={null} selectedEndId={null} />,
    )
    expect(container.textContent).toMatch(/no overlapping stations/i)
  })
})
