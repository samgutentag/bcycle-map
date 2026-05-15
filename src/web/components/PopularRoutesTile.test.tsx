import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { renderWithTheme } from '../test-utils'
import PopularRoutesTile from './PopularRoutesTile'

const STATIONS = [
  { station_id: 's1', name: 'Capitol' },
  { station_id: 's2', name: 'Library' },
  { station_id: 's3', name: 'Cabrillo' },
]

function renderTile(props: React.ComponentProps<typeof PopularRoutesTile>) {
  return renderWithTheme(<MemoryRouter><PopularRoutesTile {...props} /></MemoryRouter>)
}

describe('PopularRoutesTile', () => {
  it('renders the top routes with ranks, "from → to" names, and counts', () => {
    renderTile({
      top: [
        { from_station_id: 's1', to_station_id: 's2', count: 37 },
        { from_station_id: 's2', to_station_id: 's1', count: 35 },
        { from_station_id: 's1', to_station_id: 's3', count: 28 },
      ],
      stations: STATIONS,
      loading: false,
    })
    expect(screen.getByText(/Capitol.*→.*Library/)).toBeInTheDocument()
    expect(screen.getByText(/Library.*→.*Capitol/)).toBeInTheDocument()
    expect(screen.getByText(/Capitol.*→.*Cabrillo/)).toBeInTheDocument()
    expect(screen.getByText('37')).toBeInTheDocument()
    expect(screen.getByText('35')).toBeInTheDocument()
    expect(screen.getByText('28')).toBeInTheDocument()
  })

  it('renders loading state when loading is true', () => {
    renderTile({ top: [], stations: STATIONS, loading: true })
    expect(screen.getByText(/…/)).toBeInTheDocument()
  })

  it('renders empty-state message when not loading but top is empty', () => {
    renderTile({ top: [], stations: STATIONS, loading: false })
    expect(screen.getByText(/no popularity data/i)).toBeInTheDocument()
  })

  it('renders rows as links to the route page', () => {
    renderTile({
      top: [{ from_station_id: 's1', to_station_id: 's2', count: 37 }],
      stations: STATIONS,
      loading: false,
    })
    const link = screen.getByRole('link', { name: /Capitol.*Library/ })
    expect(link).toHaveAttribute('href', '/route/s1/s2')
  })
})
