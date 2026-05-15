import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TripRouteModal from './TripRouteModal'
import type { Trip, StationSnapshot } from '@shared/types'
import type { TravelMatrix } from '../hooks/useTravelMatrix'
import type { RouteCache } from '@shared/route-cache'

// Module-level MapLibre mock so the modal never tries to render a real WebGL canvas
vi.mock('maplibre-gl', () => {
  const Map = vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    off: vi.fn(),
    remove: vi.fn(),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    getSource: vi.fn(() => null),
    fitBounds: vi.fn(),
    setStyle: vi.fn(),
  }))
  const Marker = vi.fn().mockImplementation(() => ({
    setLngLat: vi.fn().mockReturnThis(),
    addTo: vi.fn().mockReturnThis(),
    remove: vi.fn(),
  }))
  return { default: { Map, Marker, LngLatBounds: vi.fn() }, Map, Marker, LngLatBounds: vi.fn() }
})

const TRIP: Trip = {
  departure_ts: 1_700_000_000,
  arrival_ts: 1_700_000_540,
  from_station_id: 's1',
  to_station_id: 's2',
  duration_sec: 540,
}

const STATIONS: StationSnapshot[] = [
  { station_id: 's1', name: 'Origin Station', lat: 34.42, lon: -119.7, address: '', num_bikes_available: 1, num_docks_available: 1, bikes_electric: 0, bikes_classic: 1, bikes_smart: 0, is_installed: true, is_renting: true, is_returning: true, last_reported: 0 },
  { station_id: 's2', name: 'Destination Station', lat: 34.43, lon: -119.68, address: '', num_bikes_available: 1, num_docks_available: 1, bikes_electric: 0, bikes_classic: 1, bikes_smart: 0, is_installed: true, is_renting: true, is_returning: true, last_reported: 0 },
]

const MATRIX: TravelMatrix = {
  computedAt: 1_700_000_000,
  stations: [{ id: 's1', lat: 34.42, lon: -119.7 }, { id: 's2', lat: 34.43, lon: -119.68 }],
  edges: { s1: { s2: { minutes: 7, meters: 1400 } } },
}

const ROUTES: RouteCache = {
  computedAt: 1_700_000_000,
  stations: [{ id: 's1', lat: 34.42, lon: -119.7 }, { id: 's2', lat: 34.43, lon: -119.68 }],
  edges: { s1: { s2: { polyline: '??', meters: 1400, seconds: 420, via_station_ids: [] } } },
}

function renderModal(overrides: Partial<React.ComponentProps<typeof TripRouteModal>> = {}) {
  const onClose = vi.fn()
  const utils = render(
    <MemoryRouter>
      <TripRouteModal
        trip={TRIP}
        stations={STATIONS}
        matrix={MATRIX}
        routes={ROUTES}
        systemTz="America/Los_Angeles"
        onClose={onClose}
        {...overrides}
      />
    </MemoryRouter>
  )
  return { ...utils, onClose }
}

describe('TripRouteModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the origin and destination station names in the header', () => {
    renderModal()
    expect(screen.getByText('Origin Station')).toBeInTheDocument()
    expect(screen.getByText('Destination Station')).toBeInTheDocument()
  })

  it('renders actual, typical, and distance stats', () => {
    renderModal()
    expect(screen.getByText(/9 min/)).toBeInTheDocument()    // actual = 540s
    expect(screen.getByText(/7 min/)).toBeInTheDocument()    // typical
    expect(screen.getByText(/1\.4 km|1\.4\s*km/)).toBeInTheDocument()
  })

  it('renders the approximate-route note when the route is missing', () => {
    const emptyRoutes: RouteCache = { ...ROUTES, edges: {} }
    renderModal({ routes: emptyRoutes })
    expect(screen.getByText(/approximate route/i)).toBeInTheDocument()
  })

  it('does not render the approximate-route note when the route is present', () => {
    renderModal()
    expect(screen.queryByText(/approximate route/i)).not.toBeInTheDocument()
  })

  it('closes on Escape', () => {
    const { onClose } = renderModal()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes when the backdrop is clicked', () => {
    const { onClose } = renderModal()
    fireEvent.click(screen.getByTestId('trip-route-modal-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close when the dialog body is clicked', () => {
    const { onClose } = renderModal()
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
