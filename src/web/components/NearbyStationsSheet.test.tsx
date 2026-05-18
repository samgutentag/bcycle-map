import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { StationSnapshot } from '@shared/types'
import NearbyStationsSheet from './NearbyStationsSheet'

type SuccessCb = (pos: { coords: { latitude: number; longitude: number; accuracy: number } }) => void
type ErrorCb = (err: { code: number; message: string }) => void

function installGeolocation(
  impl: (success: SuccessCb, error: ErrorCb) => void,
) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (success: SuccessCb, error: ErrorCb) => impl(success, error),
      watchPosition: () => 0,
      clearWatch: () => {},
    },
  })
}

function removeGeolocation() {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: undefined,
  })
}

function setMobile(matches: boolean) {
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

// Build a station at a tiny lat-offset from the test origin (34.4208, -119.6982).
// 0.001° lat ≈ 111 m, so offsetMeters can stay readable as e.g. 0.002 → ~220 m.
function station(overrides: Partial<StationSnapshot> & { id: string; latOffset?: number; lonOffset?: number }): StationSnapshot {
  const latOffset = overrides.latOffset ?? 0
  const lonOffset = overrides.lonOffset ?? 0
  return {
    station_id: overrides.id,
    name: overrides.name ?? `Station ${overrides.id}`,
    lat: 34.4208 + latOffset,
    lon: -119.6982 + lonOffset,
    num_bikes_available: overrides.num_bikes_available ?? 5,
    num_docks_available: overrides.num_docks_available ?? 5,
    bikes_electric: overrides.bikes_electric ?? 5,
    bikes_classic: overrides.bikes_classic ?? 0,
    bikes_smart: overrides.bikes_smart ?? 0,
    is_installed: overrides.is_installed ?? true,
    is_renting: overrides.is_renting ?? true,
    is_returning: overrides.is_returning ?? true,
    last_reported: overrides.last_reported ?? 0,
    address: overrides.address,
  } as StationSnapshot
}

const ORIGIN = { latitude: 34.4208, longitude: -119.6982, accuracy: 10 }

const STATIONS: StationSnapshot[] = [
  // ~111 m north — has bikes
  station({ id: 'close-bikes', name: 'Close & Stocked', latOffset: 0.001 }),
  // ~222 m north — empty bikes, full docks
  station({ id: 'close-empty', name: 'Close & Empty', latOffset: 0.002, num_bikes_available: 0, num_docks_available: 10 }),
  // ~333 m north — has bikes
  station({ id: 'mid-bikes', name: 'Mid & Stocked', latOffset: 0.003, num_bikes_available: 2 }),
  // ~444 m north — has bikes
  station({ id: 'fourth', name: 'Fourth & Stocked', latOffset: 0.004, num_bikes_available: 1 }),
  // ~2 km north — outside 0.5 mi
  station({ id: 'far', name: 'Far Away', latOffset: 0.018, num_bikes_available: 4 }),
  // Offline — should be filtered even when nearby
  station({ id: 'offline', name: 'Offline', latOffset: 0.0005, is_installed: false }),
]

function renderSheet(props?: Partial<React.ComponentProps<typeof NearbyStationsSheet>>) {
  const onOpenChange = props?.onOpenChange ?? (() => {})
  return render(
    <MemoryRouter>
      <NearbyStationsSheet
        stations={props?.stations ?? STATIONS}
        open={props?.open ?? true}
        onOpenChange={onOpenChange}
      />
    </MemoryRouter>,
  )
}

describe('NearbyStationsSheet', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setMobile(false)
    installGeolocation((success) => success({ coords: ORIGIN }))
  })

  afterEach(() => {
    removeGeolocation()
  })

  it('renders nothing when open is false', () => {
    renderSheet({ open: false })
    expect(screen.queryByTestId('nearby-sheet')).not.toBeInTheDocument()
  })

  it('shows the consent prompt on first open and requires a click to fetch location', () => {
    renderSheet()
    expect(screen.getByTestId('nearby-sheet-request')).toBeInTheDocument()
    // Until the user clicks, no results.
    expect(screen.queryByTestId('nearby-sheet-results')).not.toBeInTheDocument()

    act(() => { fireEvent.click(screen.getByTestId('nearby-sheet-request')) })
    expect(screen.getByTestId('nearby-sheet-results')).toBeInTheDocument()
  })

  it('auto-requests on open when permission was previously granted', () => {
    window.localStorage.setItem('bcycle-map:geolocation-granted', '1')
    renderSheet()
    expect(screen.getByTestId('nearby-sheet-results')).toBeInTheDocument()
  })

  it('returns the top 3 nearest stations with bikes, sorted by distance', () => {
    window.localStorage.setItem('bcycle-map:geolocation-granted', '1')
    renderSheet()
    const rows = screen.getAllByTestId('nearby-sheet-row')
    expect(rows).toHaveLength(3)
    // Closest first; "close-empty" should be skipped (0 bikes), and "offline"
    // should be skipped entirely. Order: close-bikes, mid-bikes, fourth.
    expect(rows[0]!.textContent).toMatch(/Close & Stocked/)
    expect(rows[1]!.textContent).toMatch(/Mid & Stocked/)
    expect(rows[2]!.textContent).toMatch(/Fourth & Stocked/)
  })

  it('switching to dock mode re-ranks for stations with open docks', () => {
    window.localStorage.setItem('bcycle-map:geolocation-granted', '1')
    renderSheet()
    act(() => { fireEvent.click(screen.getByTestId('nearby-sheet-mode-dock')) })
    const rows = screen.getAllByTestId('nearby-sheet-row')
    // Closest with docks is "close-bikes" (5 docks default), then "close-empty" (10 docks).
    expect(rows[0]!.textContent).toMatch(/Close & Stocked/)
    expect(rows[1]!.textContent).toMatch(/Close & Empty/)
  })

  it('widens to 1 mi when nothing is within 0.5 mi and labels accordingly', () => {
    window.localStorage.setItem('bcycle-map:geolocation-granted', '1')
    // Only a far station has bikes; everything closer is empty/offline.
    const allEmpty: StationSnapshot[] = [
      station({ id: 'near-empty', latOffset: 0.001, num_bikes_available: 0 }),
      // ~0.7 mi north (0.01° ≈ 1.11 km ≈ 0.69 mi)
      station({ id: 'far-bikes', name: 'Far w/ Bikes', latOffset: 0.01, num_bikes_available: 3 }),
    ]
    renderSheet({ stations: allEmpty })
    const radius = screen.getByTestId('nearby-sheet-radius')
    expect(radius.textContent).toMatch(/Closest within 1 mi/)
    const rows = screen.getAllByTestId('nearby-sheet-row')
    expect(rows[0]!.textContent).toMatch(/Far w\/ Bikes/)
  })

  it('renders an empty state when nothing is within 1 mi', () => {
    window.localStorage.setItem('bcycle-map:geolocation-granted', '1')
    const allEmpty: StationSnapshot[] = [
      station({ id: 'empty', num_bikes_available: 0 }),
    ]
    renderSheet({ stations: allEmpty })
    expect(screen.getByTestId('nearby-sheet-empty')).toBeInTheDocument()
  })

  it('shows the denied state and a retry when geolocation is rejected', () => {
    installGeolocation((_success, error) => error({ code: 1, message: 'nope' }))
    renderSheet()
    act(() => { fireEvent.click(screen.getByTestId('nearby-sheet-request')) })
    expect(screen.getByTestId('nearby-sheet-denied')).toBeInTheDocument()
    expect(screen.getByTestId('nearby-sheet-retry')).toBeInTheDocument()
  })

  it('shows the unavailable state on a non-permission error', () => {
    installGeolocation((_success, error) => error({ code: 3, message: 'timed out' }))
    renderSheet()
    act(() => { fireEvent.click(screen.getByTestId('nearby-sheet-request')) })
    expect(screen.getByTestId('nearby-sheet-unavailable')).toBeInTheDocument()
  })

  it('rows include both an Open-in-Maps and a Details link', () => {
    window.localStorage.setItem('bcycle-map:geolocation-granted', '1')
    renderSheet()
    const row = screen.getAllByTestId('nearby-sheet-row')[0]!
    const mapsLink = row.querySelector('a[href*="google.com/maps"]') as HTMLAnchorElement | null
    const detailsLink = row.querySelector('a[href*="/station/"]') as HTMLAnchorElement | null
    expect(mapsLink).not.toBeNull()
    expect(mapsLink!.href).toMatch(/travelmode=walking/)
    expect(detailsLink).not.toBeNull()
    expect(detailsLink!.getAttribute('href')).toMatch(/\/details$/)
  })

  it('close button fires onOpenChange(false)', () => {
    window.localStorage.setItem('bcycle-map:geolocation-granted', '1')
    let openState = true
    const onOpenChange = (next: boolean) => { openState = next }
    renderSheet({ onOpenChange })
    fireEvent.click(screen.getByTestId('nearby-sheet-close'))
    expect(openState).toBe(false)
  })
})
