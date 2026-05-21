import { describe, it, expect } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { renderWithTheme } from '../test-utils'
import PopularStationsTile from './PopularStationsTile'
import type { Leaderboards } from '@shared/leaderboards'

const STATIONS = [
  { station_id: 's1', name: 'State & Cota' },
  { station_id: 's2', name: 'Anacapa & Haley' },
  { station_id: 's3', name: 'Bath & Mission' },
]

const NOW_TS = 1_700_000_000

const SAMPLE: Leaderboards = {
  generated_at: NOW_TS - 3600,
  windows: {
    '30d': {
      stations: [
        { station_id: 's1', departures: 200, arrivals: 212, total: 412 },
        { station_id: 's2', departures: 190, arrivals: 198, total: 388 },
        { station_id: 's3', departures: 150, arrivals: 151, total: 301 },
      ],
      routes: [],
    },
    all: {
      stations: [
        { station_id: 's3', departures: 1500, arrivals: 1510, total: 3010 },
        { station_id: 's1', departures: 800, arrivals: 850, total: 1650 },
      ],
      routes: [],
    },
  },
}

function renderTile(props: Partial<React.ComponentProps<typeof PopularStationsTile>> = {}) {
  return renderWithTheme(
    <MemoryRouter>
      <PopularStationsTile
        data={SAMPLE}
        stations={STATIONS}
        loading={false}
        nowTs={NOW_TS}
        {...props}
      />
    </MemoryRouter>,
  )
}

describe('PopularStationsTile', () => {
  it('renders the top stations with ranks, names, totals, and in/out breakdown', () => {
    renderTile()
    expect(screen.getByText('State & Cota')).toBeInTheDocument()
    expect(screen.getByText('Anacapa & Haley')).toBeInTheDocument()
    expect(screen.getByText('Bath & Mission')).toBeInTheDocument()
    expect(screen.getByText('412')).toBeInTheDocument()
    expect(screen.getByText('388')).toBeInTheDocument()
    expect(screen.getByText('301')).toBeInTheDocument()
    expect(screen.getByText(/↑\s*200/)).toBeInTheDocument()
    expect(screen.getByText(/↓\s*212/)).toBeInTheDocument()
  })

  it('renders rows as links to station details', () => {
    renderTile()
    const link = screen.getByRole('link', { name: /state & cota/i })
    expect(link).toHaveAttribute('href', '/station/s1/details')
  })

  it('switches to the all-time window when the All tab is clicked', () => {
    renderTile()
    expect(screen.getByText('412')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'All' }))

    // All view: s3 (Bath & Mission) ranks first (3010)
    expect(screen.getByText('3010')).toBeInTheDocument()
    expect(screen.queryByText('412')).not.toBeInTheDocument()
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

  it('renders the empty state when the selected window is empty', () => {
    const emptyWindow: Leaderboards = {
      generated_at: NOW_TS - 3600,
      windows: {
        '30d': { stations: [], routes: [] },
        all: { stations: [], routes: [] },
      },
    }
    renderTile({ data: emptyWindow })
    expect(screen.getByText(/not enough data/i)).toBeInTheDocument()
  })
})
