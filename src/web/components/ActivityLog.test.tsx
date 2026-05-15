import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'
import ActivityLog from './ActivityLog'

const renderWithRouter = (el: ReactElement) =>
  render(<MemoryRouter>{el}</MemoryRouter>)
import type { ActivityLog as ActivityLogData, StationSnapshot, Trip } from '@shared/types'
import type { TravelMatrix } from '../hooks/useTravelMatrix'

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
]

const MATRIX: TravelMatrix = {
  computedAt: 0,
  stations: STATIONS.map(s => ({ id: s.station_id, lat: s.lat, lon: s.lon })),
  edges: {
    a: { b: { minutes: 12, meters: 3000 } },
    b: { a: { minutes: 13, meters: 3000 } },
  },
}

describe('ActivityLog', () => {
  it('shows the loading state when log is null', () => {
    const { container } = renderWithRouter(<ActivityLog log={null} stations={STATIONS} matrix={MATRIX} />)
    // Shows a random bike-themed verb — just assert something non-empty renders
    expect(container.textContent?.trim().length).toBeGreaterThan(0)
  })

  it('shows the empty state when no events or trips', () => {
    const log: ActivityLogData = { events: [], trips: [], inFlightFromStationId: null, inFlightDepartureTs: null }
    renderWithRouter(<ActivityLog log={log} stations={STATIONS} matrix={MATRIX} />)
    expect(screen.getByText(/no movement observed yet/i)).toBeInTheDocument()
  })

  it('renders the most recent events first, with station names looked up', () => {
    const now = Math.floor(Date.now() / 1000)
    const log: ActivityLogData = {
      events: [
        { ts: now - 600, station_id: 'a', type: 'departure', delta: 1 },
        { ts: now - 60, station_id: 'b', type: 'arrival', delta: 1 },
      ],
      trips: [],
      inFlightFromStationId: null,
      inFlightDepartureTs: null,
    }
    const { container } = renderWithRouter(<ActivityLog log={log} stations={STATIONS} matrix={MATRIX} />)
    expect(screen.getByText('Anacapa St')).toBeInTheDocument()
    expect(screen.getByText('Bath St')).toBeInTheDocument()
    // The arrival event (more recent) should appear before the departure
    const text = container.textContent ?? ''
    expect(text.indexOf('Bath St')).toBeLessThan(text.indexOf('Anacapa St'))
  })

  it('renders a multi-delta event with the multiplier', () => {
    const log: ActivityLogData = {
      events: [{ ts: Math.floor(Date.now() / 1000) - 60, station_id: 'a', type: 'departure', delta: 3 }],
      trips: [],
      inFlightFromStationId: null,
      inFlightDepartureTs: null,
    }
    renderWithRouter(<ActivityLog log={log} stations={STATIONS} matrix={MATRIX} />)
    expect(screen.getByText(/×3/)).toBeInTheDocument()
  })

  it('renders an inferred trip with actual + expected minutes', () => {
    const now = Math.floor(Date.now() / 1000)
    const log: ActivityLogData = {
      events: [],
      trips: [{
        departure_ts: now - 900,
        arrival_ts: now - 300,
        from_station_id: 'a',
        to_station_id: 'b',
        duration_sec: 600,  // 10 min
      }],
      inFlightFromStationId: null,
      inFlightDepartureTs: null,
    }
    const { container } = renderWithRouter(<ActivityLog log={log} stations={STATIONS} matrix={MATRIX} />)
    // Trip endpoints are separate <Link> elements now; assert via container text
    expect(container.textContent).toMatch(/Anacapa St.*→.*Bath St/)
    expect(screen.getByText(/10 min/)).toBeInTheDocument()
    expect(screen.getByText(/expected 12 min/)).toBeInTheDocument()
    expect(screen.getByText(/\(-2\)/)).toBeInTheDocument()
  })

  it('omits the expected comparison when matrix has no edge for the pair', () => {
    const now = Math.floor(Date.now() / 1000)
    const log: ActivityLogData = {
      events: [],
      trips: [{
        departure_ts: now - 900,
        arrival_ts: now - 300,
        from_station_id: 'a',
        to_station_id: 'missing',
        duration_sec: 600,
      }],
      inFlightFromStationId: null,
      inFlightDepartureTs: null,
    }
    renderWithRouter(<ActivityLog log={log} stations={STATIONS} matrix={MATRIX} />)
    expect(screen.queryByText(/expected/i)).not.toBeInTheDocument()
  })

  it('fires onTripClick with the trip when a trip row is clicked', () => {
    const trip: Trip = { departure_ts: 1_700_000_000, arrival_ts: 1_700_000_540, from_station_id: 'a', to_station_id: 'b', duration_sec: 540 }
    const log: ActivityLogData = {
      events: [],
      trips: [trip],
      inFlightFromStationId: null,
      inFlightDepartureTs: null,
    }
    const onTripClick = vi.fn()
    renderWithRouter(<ActivityLog log={log} stations={STATIONS} matrix={MATRIX} onTripClick={onTripClick} />)
    fireEvent.click(screen.getByRole('button', { name: /anacapa.*bath/i }))
    expect(onTripClick).toHaveBeenCalledWith(trip)
  })

  it('does not fire onTripClick when a station-name link inside a trip row is clicked', () => {
    const trip: Trip = { departure_ts: 1_700_000_000, arrival_ts: 1_700_000_540, from_station_id: 'a', to_station_id: 'b', duration_sec: 540 }
    const log: ActivityLogData = {
      events: [],
      trips: [trip],
      inFlightFromStationId: null,
      inFlightDepartureTs: null,
    }
    const onTripClick = vi.fn()
    renderWithRouter(<ActivityLog log={log} stations={STATIONS} matrix={MATRIX} onTripClick={onTripClick} />)
    const link = screen.getAllByRole('link').find(a => /anacapa/i.test(a.textContent ?? '')) as HTMLElement
    fireEvent.click(link)
    expect(onTripClick).not.toHaveBeenCalled()
  })
})
