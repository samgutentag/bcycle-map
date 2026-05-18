import { describe, it, expect } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import SystemTotals, { computeTotals } from './SystemTotals'
import type { ActivityEvent, StationSnapshot } from '@shared/types'
import { renderWithTheme } from '../test-utils'

const make = (overrides: Partial<StationSnapshot> = {}): StationSnapshot => ({
  station_id: 'a',
  name: 'A',
  lat: 0,
  lon: 0,
  num_bikes_available: 3,
  num_docks_available: 7,
  bikes_electric: 3,
  bikes_classic: 0,
  bikes_smart: 0,
  is_installed: true,
  is_renting: true,
  is_returning: true,
  last_reported: 0,
  ...overrides,
})

const ev = (overrides: Partial<ActivityEvent> = {}): ActivityEvent => ({
  ts: Math.floor(Date.now() / 1000) - 60,
  station_id: 'a',
  type: 'departure',
  delta: 1,
  ...overrides,
})

describe('computeTotals', () => {
  it('sums bikes and docks across stations', () => {
    const t = computeTotals([
      make({ num_bikes_available: 2, num_docks_available: 8 }),
      make({ num_bikes_available: 5, num_docks_available: 3 }),
    ])
    expect(t.bikes).toBe(7)
    expect(t.docks).toBe(11)
  })

  it('counts stations as online only when both is_installed and is_renting', () => {
    const t = computeTotals([
      make(),
      make({ is_renting: false }),
      make({ is_installed: false }),
    ])
    expect(t.stationsOnline).toBe(1)
  })

  it('returns zeros for empty input', () => {
    const t = computeTotals([])
    expect(t).toEqual({ bikes: 0, docks: 0, stationsOnline: 0, totalDockSlots: 0 })
  })

  it('derives totalDockSlots as bikes + docks', () => {
    const t = computeTotals([
      make({ num_bikes_available: 3, num_docks_available: 7 }),
      make({ num_bikes_available: 5, num_docks_available: 4 }),
    ])
    expect(t.totalDockSlots).toBe(19)
  })
})

describe('SystemTotals', () => {
  it('renders the total bikes available number', () => {
    const { container } = renderWithTheme(<SystemTotals stations={[
      make({ num_bikes_available: 4, num_docks_available: 6 }),
      make({ num_bikes_available: 1, num_docks_available: 9 }),
    ]} />)
    // Totals: bikes=5
    expect(container.textContent).toContain('5')
    expect(container.textContent).toMatch(/bikes available/i)
  })

  it('renders the bikes / maxBikesEver denominator when maxBikesEver is provided', () => {
    const { container } = renderWithTheme(
      <SystemTotals
        stations={[make({ num_bikes_available: 5, num_docks_available: 5 })]}
        maxBikesEver={250}
      />,
    )
    expect(container.textContent).toContain('/ 250')
  })

  it('renders active riders block only when maxBikesEver is known', () => {
    const without = renderWithTheme(
      <SystemTotals stations={[make({ num_bikes_available: 5, num_docks_available: 5 })]} />,
    )
    expect(without.container.textContent).not.toMatch(/active riders/i)
    without.unmount()
    const withMax = renderWithTheme(
      <SystemTotals
        stations={[make({ num_bikes_available: 5, num_docks_available: 5 })]}
        maxBikesEver={20}
      />,
    )
    expect(withMax.container.textContent).toMatch(/active riders/i)
  })
})

describe('SystemTotals — recent activity section', () => {
  it('does not render the activity section when no recentEvents are passed', () => {
    const { queryByTestId } = renderWithTheme(
      <MemoryRouter>
        <SystemTotals stations={[make()]} />
      </MemoryRouter>,
    )
    expect(queryByTestId('system-totals-recent-activity')).toBeNull()
  })

  it('does not render the activity section when recentEvents is empty', () => {
    const { queryByTestId } = renderWithTheme(
      <MemoryRouter>
        <SystemTotals stations={[make()]} recentEvents={[]} />
      </MemoryRouter>,
    )
    expect(queryByTestId('system-totals-recent-activity')).toBeNull()
  })

  it('renders the 5 most recent events sorted newest-first, even when input is unordered', () => {
    const now = Math.floor(Date.now() / 1000)
    // Mix of recent + old events with distinct station ids so we can assert
    // exactly which ones fall outside the top-5 window.
    const events: ActivityEvent[] = [
      ev({ ts: now - 600, station_id: 'old1', type: 'departure' }),
      ev({ ts: now - 60,  station_id: 'b', type: 'arrival' }),
      ev({ ts: now - 300, station_id: 'a', type: 'arrival' }),
      ev({ ts: now - 30,  station_id: 'c', type: 'departure' }),
      ev({ ts: now - 900, station_id: 'old2', type: 'departure' }),
      ev({ ts: now - 120, station_id: 'b', type: 'departure' }),
      ev({ ts: now - 200, station_id: 'c', type: 'arrival' }),
    ]
    const stations = [
      make({ station_id: 'a', name: 'Alpha' }),
      make({ station_id: 'b', name: 'Beta' }),
      make({ station_id: 'c', name: 'Gamma' }),
      make({ station_id: 'old1', name: 'OldOne' }),
      make({ station_id: 'old2', name: 'OldTwo' }),
    ]
    const { getByTestId } = renderWithTheme(
      <MemoryRouter>
        <SystemTotals stations={stations} recentEvents={events} />
      </MemoryRouter>,
    )
    const section = getByTestId('system-totals-recent-activity')
    expect(section).toBeTruthy()
    // Only the 5 most recent station-name links render
    const links = section.querySelectorAll('a[href^="/station/"]')
    expect(links).toHaveLength(5)
    // First row is the most-recent event (Gamma, 30s ago)
    expect(links[0].textContent).toContain('Gamma')
    // The two oldest events (now-600, now-900) drop out
    expect(section.textContent).not.toContain('OldOne')
    expect(section.textContent).not.toContain('OldTwo')
    // View-more link points at /activity
    const viewMore = section.querySelector('a[href="/activity"]')
    expect(viewMore?.textContent).toMatch(/view more/i)
  })

  it('honors recentActivityLimit when overridden', () => {
    const now = Math.floor(Date.now() / 1000)
    const events: ActivityEvent[] = Array.from({ length: 10 }, (_, i) =>
      ev({ ts: now - (i + 1) * 10, station_id: 'a', type: 'departure' }),
    )
    const { getByTestId } = renderWithTheme(
      <MemoryRouter>
        <SystemTotals stations={[make()]} recentEvents={events} recentActivityLimit={3} />
      </MemoryRouter>,
    )
    const section = getByTestId('system-totals-recent-activity')
    expect(section.querySelectorAll('a[href^="/station/"]')).toHaveLength(3)
  })

  it('falls back to station_id when the station is not in the stations array', () => {
    const events = [ev({ station_id: 'unknown-id', type: 'departure' })]
    const { getByTestId } = renderWithTheme(
      <MemoryRouter>
        <SystemTotals stations={[]} recentEvents={events} />
      </MemoryRouter>,
    )
    const section = getByTestId('system-totals-recent-activity')
    expect(section.textContent).toContain('unknown-id')
  })

  it('renders the ×N delta suffix only when delta > 1', () => {
    const now = Math.floor(Date.now() / 1000)
    const events: ActivityEvent[] = [
      ev({ ts: now - 60, station_id: 'a', delta: 1 }),
      ev({ ts: now - 30, station_id: 'a', delta: 3 }),
    ]
    const { getByTestId } = renderWithTheme(
      <MemoryRouter>
        <SystemTotals stations={[make({ station_id: 'a', name: 'Alpha' })]} recentEvents={events} />
      </MemoryRouter>,
    )
    const section = getByTestId('system-totals-recent-activity')
    expect(section.textContent).toContain('×3')
    // The delta=1 row renders without a ×1 suffix
    const text = section.textContent ?? ''
    expect(text.match(/×1/)).toBeNull()
  })
})
