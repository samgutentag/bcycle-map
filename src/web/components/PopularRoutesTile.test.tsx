import { describe, it, expect } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { renderWithTheme } from '../test-utils'
import PopularRoutesTile from './PopularRoutesTile'
import type { Leaderboards } from '@shared/leaderboards'

const STATIONS = [
  { station_id: 's1', name: 'Capitol' },
  { station_id: 's2', name: 'Library' },
  { station_id: 's3', name: 'Cabrillo' },
]

const NOW_TS = 1_700_000_000

const SAMPLE: Leaderboards = {
  generated_at: NOW_TS - 3600,
  windows: {
    '30d': {
      stations: [],
      routes: [
        { from: 's1', to: 's2', trips: 37 },
        { from: 's2', to: 's1', trips: 35 },
        { from: 's1', to: 's3', trips: 28 },
      ],
    },
    all: {
      stations: [],
      routes: [
        { from: 's3', to: 's1', trips: 220 },
        { from: 's1', to: 's2', trips: 180 },
      ],
    },
  },
}

function renderTile(props: Partial<React.ComponentProps<typeof PopularRoutesTile>> = {}) {
  return renderWithTheme(
    <MemoryRouter>
      <PopularRoutesTile
        data={SAMPLE}
        stations={STATIONS}
        loading={false}
        nowTs={NOW_TS}
        {...props}
      />
    </MemoryRouter>,
  )
}

describe('PopularRoutesTile', () => {
  it('renders the top routes with ranks, "from → to" names, and trip counts', () => {
    renderTile()
    expect(screen.getByText(/Capitol.*→.*Library/)).toBeInTheDocument()
    expect(screen.getByText(/Library.*→.*Capitol/)).toBeInTheDocument()
    expect(screen.getByText(/Capitol.*→.*Cabrillo/)).toBeInTheDocument()
    expect(screen.getByText('37')).toBeInTheDocument()
    expect(screen.getByText('35')).toBeInTheDocument()
    expect(screen.getByText('28')).toBeInTheDocument()
  })

  it('renders rows as links to the route page', () => {
    renderTile()
    const link = screen.getByRole('link', { name: /Capitol.*Library/ })
    expect(link).toHaveAttribute('href', '/route/s1/s2')
  })

  it('switches to the all-time window when the All tab is clicked', () => {
    renderTile()
    expect(screen.getByText('37')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'All' }))
    expect(screen.getByText('220')).toBeInTheDocument()
    expect(screen.queryByText('37')).not.toBeInTheDocument()
  })

  it('renders the loading state when loading is true', () => {
    renderTile({ data: null, loading: true })
    expect(screen.getByText(/…/)).toBeInTheDocument()
  })

  it('renders the empty state when data is null', () => {
    renderTile({ data: null })
    expect(screen.getByText(/not enough data/i)).toBeInTheDocument()
  })

  it('renders the empty state when the rollup is older than 48h', () => {
    const stale: Leaderboards = { ...SAMPLE, generated_at: NOW_TS - 50 * 3600 }
    renderTile({ data: stale })
    expect(screen.getByText(/not enough data/i)).toBeInTheDocument()
  })

  it('renders the empty state when the selected window has no routes (e.g. all below the 5-trip threshold)', () => {
    const empty: Leaderboards = {
      generated_at: NOW_TS - 3600,
      windows: {
        '30d': { stations: [], routes: [] },
        all: { stations: [], routes: [] },
      },
    }
    renderTile({ data: empty })
    expect(screen.getByText(/not enough data/i)).toBeInTheDocument()
  })
})
