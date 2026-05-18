import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, useSearchParams } from 'react-router-dom'
import type { ReactElement } from 'react'
import type { ActivityLog as ActivityLogData, StationSnapshot } from '@shared/types'

// Mock the data hooks so the drawer can be tested without network. Each test
// drives the activity payload via the setter exported below.
let mockActivity: ActivityLogData | null = null
vi.mock('../hooks/useActivity', () => ({
  useActivity: () => ({ data: mockActivity, error: null }),
}))
vi.mock('../hooks/useTravelMatrix', () => ({
  useTravelMatrix: () => ({ data: null, loading: false, error: null }),
  lookupTravelTime: () => null,
}))
vi.mock('../hooks/useRouteCache', () => ({
  useRouteCache: () => ({ data: null, loading: false, error: null }),
}))
// Stub TripRouteModal — its real impl pulls in maplibre-gl which we don't need.
vi.mock('./TripRouteModal', () => ({
  default: () => null,
}))

import ActivityDrawer from './ActivityDrawer'

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
  station('c', 'Carrillo & State'),
]

function setMobile(matches: boolean) {
  // Override matchMedia so the drawer picks the right layout. happy-dom
  // doesn't fire change events automatically, so the initial useState read
  // and any later useEffect re-evaluation are what matters here.
  ;(window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = (q: string) => ({
    matches,
    media: q,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  } as unknown as MediaQueryList)
}

function renderWith(initialEntries: string[] = ['/live']): ReactElement {
  return (
    <MemoryRouter initialEntries={initialEntries}>
      <ActivityDrawer stations={STATIONS} timezone="UTC" />
      <SearchParamsProbe />
    </MemoryRouter>
  )
}

// Helper that surfaces the current `activity` search-param value into the DOM
// so we can assert that toggling the drawer mutates the URL.
function SearchParamsProbe() {
  const [params] = useSearchParams()
  return <div data-testid="search-probe">{params.get('activity') ?? ''}</div>
}

describe('ActivityDrawer', () => {
  beforeEach(() => {
    mockActivity = null
    setMobile(false)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders collapsed by default and shows the open trigger', () => {
    render(renderWith())
    expect(screen.getByTestId('activity-drawer-collapsed')).toBeInTheDocument()
    expect(screen.queryByTestId('activity-drawer-expanded')).not.toBeInTheDocument()
  })

  it('opens when the collapsed strip is clicked and writes ?activity=open to the URL', () => {
    render(renderWith())
    expect(screen.getByTestId('search-probe').textContent).toBe('')

    fireEvent.click(screen.getByTestId('activity-drawer-collapsed'))

    expect(screen.getByTestId('activity-drawer-expanded')).toBeInTheDocument()
    expect(screen.getByTestId('search-probe').textContent).toBe('open')
  })

  it('initial URL with ?activity=open opens the drawer', () => {
    render(renderWith(['/live?activity=open']))
    expect(screen.getByTestId('activity-drawer-expanded')).toBeInTheDocument()
    expect(screen.queryByTestId('activity-drawer-collapsed')).not.toBeInTheDocument()
  })

  it('closing the drawer clears the URL param', () => {
    render(renderWith(['/live?activity=open']))
    fireEvent.click(screen.getByTestId('activity-drawer-close'))
    expect(screen.getByTestId('activity-drawer-collapsed')).toBeInTheDocument()
    expect(screen.getByTestId('search-probe').textContent).toBe('')
  })

  it('ticker shows the latest event description', () => {
    const now = Math.floor(Date.now() / 1000)
    mockActivity = {
      events: [
        { ts: now - 600, station_id: 'a', type: 'departure', delta: 1 },
        { ts: now - 14, station_id: 'c', type: 'departure', delta: 1 },
      ],
      trips: [],
      inFlightFromStationId: null,
      inFlightDepartureTs: null,
    }
    render(renderWith())
    const ticker = screen.getByTestId('activity-drawer-ticker')
    expect(ticker.textContent).toMatch(/Carrillo & State/)
    expect(ticker.textContent).toMatch(/−1 bike/)
    expect(ticker.textContent).toMatch(/(s|m) ago/)
  })

  it('unread badge increments as new events arrive while drawer is closed', () => {
    const now = Math.floor(Date.now() / 1000)
    mockActivity = {
      events: [{ ts: now - 30, station_id: 'a', type: 'departure', delta: 1 }],
      trips: [],
      inFlightFromStationId: null,
      inFlightDepartureTs: null,
    }
    const { rerender } = render(renderWith())
    // First render initializes lastSeen to "now"; the single existing event
    // is older than that so unread should still be 0.
    expect(screen.queryByTestId('activity-drawer-unread-badge')).not.toBeInTheDocument()

    // A newer event arrives. Bump it just slightly past "now" so the filter
    // picks it up regardless of test-clock drift.
    mockActivity = {
      events: [
        { ts: now - 30, station_id: 'a', type: 'departure', delta: 1 },
        { ts: now + 600, station_id: 'b', type: 'arrival', delta: 2 },
      ],
      trips: [],
      inFlightFromStationId: null,
      inFlightDepartureTs: null,
    }
    rerender(renderWith())
    expect(screen.getByTestId('activity-drawer-unread-badge').textContent).toBe('1')
  })

  it('opening the drawer resets the unread badge', () => {
    const now = Math.floor(Date.now() / 1000)
    mockActivity = {
      events: [{ ts: now + 600, station_id: 'b', type: 'arrival', delta: 1 }],
      trips: [],
      inFlightFromStationId: null,
      inFlightDepartureTs: null,
    }
    render(renderWith())
    expect(screen.getByTestId('activity-drawer-unread-badge').textContent).toBe('1')
    fireEvent.click(screen.getByTestId('activity-drawer-collapsed'))
    // Expanded view doesn't render the badge at all.
    expect(screen.queryByTestId('activity-drawer-unread-badge')).not.toBeInTheDocument()
  })

  it('defaults to events-only view in the expanded panel, with a trips toggle', () => {
    render(renderWith(['/live?activity=open']))
    expect(screen.getByTestId('activity-drawer-events-only')).toBeInTheDocument()
    const trips = screen.getByTestId('activity-drawer-trips-toggle')
    expect(trips.getAttribute('aria-pressed')).toBe('false')

    act(() => { fireEvent.click(trips) })
    expect(trips.getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByTestId('activity-drawer-events-only')).not.toBeInTheDocument()
  })

  it('renders a bottom-sheet collapsed strip on mobile viewports', () => {
    setMobile(true)
    render(renderWith())
    const collapsed = screen.getByTestId('activity-drawer-collapsed')
    // Mobile strip should render the ticker inline (desktop hides it inside
    // a rotated vertical block; this asserts the mobile branch took effect).
    expect(collapsed.textContent).toMatch(/Activity/i)
    expect(screen.getByTestId('activity-drawer-ticker')).toBeInTheDocument()
  })
})
