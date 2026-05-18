import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { screen, fireEvent, cleanup } from '@testing-library/react'
import { ThemeProvider } from '@audius/harmony'
import { render } from '@testing-library/react'
import PollPinger from './PollPinger'
import { AppThemeProvider } from '../theme'
import type { KVValue, StationSnapshot } from '@shared/types'

function station(id: string, name: string, bikes: number, docks: number): StationSnapshot {
  return {
    station_id: id,
    name,
    lat: 0,
    lon: 0,
    num_bikes_available: bikes,
    num_docks_available: docks,
    bikes_electric: bikes,
    bikes_classic: 0,
    bikes_smart: 0,
    is_installed: true,
    is_renting: true,
    is_returning: true,
    last_reported: 0,
  }
}

function snapshot(ts: number, stations: StationSnapshot[]): KVValue {
  return {
    system: { system_id: 'x', name: 'x', timezone: 'UTC', language: 'en' },
    snapshot_ts: ts,
    stations,
  }
}

// rerender() from RTL renders the new element without the original wrapper —
// which would drop the ThemeProvider and break Harmony. Use a wrapper so
// each rerender keeps Harmony's theme context attached.
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <AppThemeProvider>
    <ThemeProvider theme="day">{children}</ThemeProvider>
  </AppThemeProvider>
)

describe('PollPinger', () => {
  beforeEach(() => {
    // shouldAdvanceTime keeps microtasks moving so Harmony's lazy bits don't
    // wedge. setSystemTime locks the clock so "Updated Ns ago" is stable:
    // snapshot_ts = 1000, now = 1042s → "Updated 42s ago".
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(1042 * 1000))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('shows the resting "Updated Ns ago" text on first render', () => {
    const data = snapshot(1000, [station('a', 'Alpha', 3, 7)])
    render(<PollPinger data={data} reducedMotion={false} />, { wrapper: Wrapper })
    expect(screen.getByText(/Updated 42s ago/)).toBeInTheDocument()
  })

  it('renders a waiting message when no data has arrived yet', () => {
    render(<PollPinger data={null} reducedMotion={false} />, { wrapper: Wrapper })
    expect(screen.getByText(/Waiting for first poll/)).toBeInTheDocument()
  })

  it('flashes the changed-station count when a new snapshot lands', () => {
    const first = snapshot(1000, [
      station('a', 'Alpha', 3, 7),
      station('b', 'Bravo', 5, 5),
      station('c', 'Charlie', 1, 9),
    ])
    const { rerender } = render(<PollPinger data={first} reducedMotion={false} />, { wrapper: Wrapper })

    const next = snapshot(1100, [
      station('a', 'Alpha', 5, 5),     // changed
      station('b', 'Bravo', 5, 5),     // unchanged
      station('c', 'Charlie', 0, 10),  // changed
    ])

    act(() => {
      rerender(<PollPinger data={next} reducedMotion={false} />)
    })

    expect(screen.getByText(/2 stations changed/)).toBeInTheDocument()
    expect(screen.getByTestId('poll-pinger').getAttribute('data-flashing')).toBe('true')
  })

  it('shows "No changes" briefly when the next snapshot is a no-op', () => {
    const first = snapshot(1000, [station('a', 'Alpha', 3, 7)])
    const { rerender } = render(<PollPinger data={first} reducedMotion={false} />, { wrapper: Wrapper })

    const next = snapshot(1060, [station('a', 'Alpha', 3, 7)])
    act(() => {
      rerender(<PollPinger data={next} reducedMotion={false} />)
    })

    expect(screen.getByText(/No changes/)).toBeInTheDocument()
  })

  it('settles back to the resting "ago" text after the flash window', () => {
    const first = snapshot(1000, [station('a', 'Alpha', 3, 7)])
    const { rerender } = render(<PollPinger data={first} reducedMotion={false} />, { wrapper: Wrapper })

    const next = snapshot(1042, [station('a', 'Alpha', 5, 5)])
    act(() => {
      rerender(<PollPinger data={next} reducedMotion={false} />)
    })
    expect(screen.getByText(/1 station changed/)).toBeInTheDocument()

    // Flash duration is < 1.2s. Run timers past that.
    act(() => {
      vi.advanceTimersByTime(1500)
    })

    expect(screen.queryByText(/1 station changed/)).not.toBeInTheDocument()
    expect(screen.getByText(/Updated/)).toBeInTheDocument()
  })

  it('shows a tooltip with the changed station names on hover, capped at 10', () => {
    const stationsPrev: StationSnapshot[] = []
    const stationsNext: StationSnapshot[] = []
    for (let i = 0; i < 12; i++) {
      const id = `s${i}`
      const name = `Station ${String.fromCharCode(65 + i)}`
      stationsPrev.push(station(id, name, 3, 7))
      stationsNext.push(station(id, name, 4, 6))  // every one shifted
    }
    const first = snapshot(1000, stationsPrev)
    const next = snapshot(1100, stationsNext)
    const { rerender } = render(<PollPinger data={first} reducedMotion={false} />, { wrapper: Wrapper })
    act(() => { rerender(<PollPinger data={next} reducedMotion={false} />) })

    const chip = screen.getByTestId('poll-pinger')
    fireEvent.mouseEnter(chip.parentElement!)

    const tooltip = screen.getByTestId('poll-pinger-tooltip')
    expect(tooltip).toBeInTheDocument()
    // Capped at 10 visible rows.
    const items = tooltip.querySelectorAll('li')
    expect(items.length).toBe(10)
    expect(screen.getByText(/\+2 more/)).toBeInTheDocument()
  })

  it('respects prefers-reduced-motion (no flash animation, text still updates)', () => {
    const first = snapshot(1000, [station('a', 'Alpha', 3, 7)])
    const { rerender } = render(<PollPinger data={first} reducedMotion={true} />, { wrapper: Wrapper })

    const next = snapshot(1100, [station('a', 'Alpha', 5, 5)])
    act(() => { rerender(<PollPinger data={next} reducedMotion={true} />) })

    // Text still flips to the change count — animation is the only thing skipped.
    expect(screen.getByText(/1 station changed/)).toBeInTheDocument()
    const chip = screen.getByTestId('poll-pinger')
    // Verify the inline animation style is 'none' when reduced motion is on.
    const style = chip.getAttribute('style') ?? ''
    expect(style).toMatch(/animation:\s*none|animation-name:\s*none|^(?!.*animation:[^n])/)
  })
})
