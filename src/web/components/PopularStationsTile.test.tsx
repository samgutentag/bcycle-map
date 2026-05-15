import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { renderWithTheme } from '../test-utils'
import PopularStationsTile from './PopularStationsTile'

const STATIONS = [
  { station_id: 's1', name: 'State & Cota' },
  { station_id: 's2', name: 'Anacapa & Haley' },
  { station_id: 's3', name: 'Bath & Mission' },
]

function renderTile(props: React.ComponentProps<typeof PopularStationsTile>) {
  return renderWithTheme(<MemoryRouter><PopularStationsTile {...props} /></MemoryRouter>)
}

describe('PopularStationsTile', () => {
  it('renders the top stations with ranks, names, and counts', () => {
    renderTile({
      top: [
        { station_id: 's1', count: 412 },
        { station_id: 's2', count: 388 },
        { station_id: 's3', count: 301 },
      ],
      stations: STATIONS,
      loading: false,
    })
    expect(screen.getByText('State & Cota')).toBeInTheDocument()
    expect(screen.getByText('Anacapa & Haley')).toBeInTheDocument()
    expect(screen.getByText('Bath & Mission')).toBeInTheDocument()
    expect(screen.getByText('412')).toBeInTheDocument()
    expect(screen.getByText('388')).toBeInTheDocument()
    expect(screen.getByText('301')).toBeInTheDocument()
  })

  it('renders loading state when loading is true', () => {
    renderTile({ top: [], stations: STATIONS, loading: true })
    expect(screen.getByText(/…/)).toBeInTheDocument()
  })

  it('renders empty-state message when not loading but top is empty', () => {
    renderTile({ top: [], stations: STATIONS, loading: false })
    expect(screen.getByText(/no popularity data/i)).toBeInTheDocument()
  })

  it('renders rows as links to station details', () => {
    renderTile({
      top: [{ station_id: 's1', count: 412 }],
      stations: STATIONS,
      loading: false,
    })
    const link = screen.getByRole('link', { name: /state & cota/i })
    expect(link).toHaveAttribute('href', '/station/s1/details')
  })
})
