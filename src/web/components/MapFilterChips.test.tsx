import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { renderWithTheme } from '../test-utils'
import MapFilterChips from './MapFilterChips'

afterEach(() => cleanup())

type Overrides = {
  minBikes?: number
  offlineOnly?: boolean
  filteredCount?: number
  totalCount?: number
}

function renderChips(overrides: Overrides = {}) {
  const onMinBikesChange = vi.fn()
  const onOfflineOnlyChange = vi.fn()
  const onReset = vi.fn()
  renderWithTheme(
    <MapFilterChips
      minBikes={overrides.minBikes ?? 0}
      offlineOnly={overrides.offlineOnly ?? false}
      filteredCount={overrides.filteredCount ?? 26}
      totalCount={overrides.totalCount ?? 26}
      onMinBikesChange={onMinBikesChange}
      onOfflineOnlyChange={onOfflineOnlyChange}
      onReset={onReset}
    />,
  )
  return { onMinBikesChange, onOfflineOnlyChange, onReset }
}

describe('MapFilterChips', () => {
  it('renders both chips with default labels when no filters are active', () => {
    renderChips()
    expect(screen.getByTestId('filter-chip-min-bikes')).toHaveTextContent('Min bikes: Any')
    expect(screen.getByTestId('filter-chip-offline')).toHaveTextContent('Offline only')
  })

  it('hides Reset and station-count subline when no filter is active', () => {
    renderChips()
    expect(screen.queryByTestId('filter-chip-reset')).toBeNull()
    expect(screen.queryByTestId('filter-chip-count')).toBeNull()
  })

  it('shows "1+" / "3+" / "5+" labels when minBikes is set', () => {
    const { rerender } = renderTwoStates()
    expect(screen.getByTestId('filter-chip-min-bikes')).toHaveTextContent('Min bikes: 1+')
    rerender(3)
    expect(screen.getByTestId('filter-chip-min-bikes')).toHaveTextContent('Min bikes: 3+')
    rerender(5)
    expect(screen.getByTestId('filter-chip-min-bikes')).toHaveTextContent('Min bikes: 5+')
  })

  it('cycles minBikes on chip click', () => {
    const { onMinBikesChange } = renderChips({ minBikes: 0 })
    fireEvent.click(screen.getByTestId('filter-chip-min-bikes'))
    expect(onMinBikesChange).toHaveBeenCalledWith(1)
  })

  it('cycles from 5+ back to Any', () => {
    const { onMinBikesChange } = renderChips({ minBikes: 5 })
    fireEvent.click(screen.getByTestId('filter-chip-min-bikes'))
    expect(onMinBikesChange).toHaveBeenCalledWith(0)
  })

  it('toggles offlineOnly when its chip is clicked', () => {
    const { onOfflineOnlyChange } = renderChips({ offlineOnly: false })
    fireEvent.click(screen.getByTestId('filter-chip-offline'))
    expect(onOfflineOnlyChange).toHaveBeenCalledWith(true)
  })

  it('shows a per-chip × button when active that clears that filter only', () => {
    const { onMinBikesChange, onOfflineOnlyChange } = renderChips({
      minBikes: 3,
      offlineOnly: true,
    })
    fireEvent.click(screen.getByTestId('filter-chip-min-bikes-clear'))
    expect(onMinBikesChange).toHaveBeenLastCalledWith(0)
    expect(onOfflineOnlyChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('filter-chip-offline-clear'))
    expect(onOfflineOnlyChange).toHaveBeenLastCalledWith(false)
  })

  it('renders Reset link and station count when any filter is active', () => {
    renderChips({ minBikes: 1, filteredCount: 10, totalCount: 26 })
    expect(screen.getByTestId('filter-chip-reset')).toBeInTheDocument()
    expect(screen.getByTestId('filter-chip-count')).toHaveTextContent('Showing 10 of 26 stations')
  })

  it('calls onReset when Reset link is clicked', () => {
    const { onReset } = renderChips({ offlineOnly: true })
    fireEvent.click(screen.getByTestId('filter-chip-reset'))
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it('sets aria-pressed on each chip', () => {
    renderChips({ minBikes: 3, offlineOnly: false })
    expect(screen.getByTestId('filter-chip-min-bikes')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('filter-chip-offline')).toHaveAttribute('aria-pressed', 'false')
  })

  it('clicking the × does NOT also cycle minBikes', () => {
    // Click event on the inner × should stopPropagation so the parent chip's
    // onClick (which would call nextMinBikes) never fires.
    const { onMinBikesChange } = renderChips({ minBikes: 3 })
    fireEvent.click(screen.getByTestId('filter-chip-min-bikes-clear'))
    expect(onMinBikesChange).toHaveBeenCalledTimes(1)
    expect(onMinBikesChange).toHaveBeenCalledWith(0)
  })
})

// Helper to swap props mid-test by re-rendering with a fresh wrapper. RTL's
// own rerender drops Harmony, and we need the theme on every pass.
function renderTwoStates() {
  renderChips({ minBikes: 1 })
  function rerender(next: number) {
    cleanup()
    renderChips({ minBikes: next })
  }
  return { rerender }
}
