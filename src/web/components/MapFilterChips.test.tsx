import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { renderWithTheme } from '../test-utils'
import MapFilterChips from './MapFilterChips'
import type { CorridorId } from '../config/corridors'

afterEach(() => cleanup())

type Overrides = {
  minBikes?: number
  corridor?: CorridorId | null
  filteredCount?: number
  totalCount?: number
}

function renderChips(overrides: Overrides = {}) {
  const onMinBikesChange = vi.fn()
  const onCorridorChange = vi.fn()
  const onReset = vi.fn()
  renderWithTheme(
    <MapFilterChips
      minBikes={overrides.minBikes ?? 0}
      corridor={overrides.corridor ?? null}
      filteredCount={overrides.filteredCount ?? 26}
      totalCount={overrides.totalCount ?? 26}
      onMinBikesChange={onMinBikesChange}
      onCorridorChange={onCorridorChange}
      onReset={onReset}
    />,
  )
  return { onMinBikesChange, onCorridorChange, onReset }
}

describe('MapFilterChips', () => {
  it('renders the min-bikes chip with its default label when no filter is active', () => {
    renderChips()
    expect(screen.getByTestId('filter-chip-min-bikes')).toHaveTextContent('Min bikes: Any')
  })

  it('does not render the legacy offline-only chip', () => {
    renderChips()
    expect(screen.queryByTestId('filter-chip-offline')).toBeNull()
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

  it('shows a per-chip × button when active that clears that filter only', () => {
    const { onMinBikesChange } = renderChips({ minBikes: 3 })
    fireEvent.click(screen.getByTestId('filter-chip-min-bikes-clear'))
    expect(onMinBikesChange).toHaveBeenLastCalledWith(0)
  })

  it('renders Reset link and station count when any filter is active', () => {
    renderChips({ minBikes: 1, filteredCount: 10, totalCount: 26 })
    expect(screen.getByTestId('filter-chip-reset')).toBeInTheDocument()
    expect(screen.getByTestId('filter-chip-count')).toHaveTextContent('Showing 10 of 26 stations')
  })

  it('calls onReset when Reset link is clicked', () => {
    const { onReset } = renderChips({ minBikes: 3 })
    fireEvent.click(screen.getByTestId('filter-chip-reset'))
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it('sets aria-pressed on the min-bikes chip', () => {
    renderChips({ minBikes: 3 })
    expect(screen.getByTestId('filter-chip-min-bikes')).toHaveAttribute('aria-pressed', 'true')
  })

  it('clicking the × does NOT also cycle minBikes', () => {
    // Click event on the inner × should stopPropagation so the parent chip's
    // onClick (which would call nextMinBikes) never fires.
    const { onMinBikesChange } = renderChips({ minBikes: 3 })
    fireEvent.click(screen.getByTestId('filter-chip-min-bikes-clear'))
    expect(onMinBikesChange).toHaveBeenCalledTimes(1)
    expect(onMinBikesChange).toHaveBeenCalledWith(0)
  })

  describe('corridor chip', () => {
    it('renders "Corridor: All" by default with no clear button', () => {
      renderChips()
      const select = screen.getByTestId('filter-chip-corridor') as HTMLSelectElement
      expect(select).toBeInTheDocument()
      expect(select.value).toBe('')
      expect(screen.queryByTestId('filter-chip-corridor-clear')).toBeNull()
    })

    it('renders the corridor label and × clear button when active', () => {
      renderChips({ corridor: 'waterfront' })
      // Label rendered inline as "Corridor: Waterfront"
      expect(screen.getByText(/Corridor: Waterfront/)).toBeInTheDocument()
      expect(screen.getByTestId('filter-chip-corridor-clear')).toBeInTheDocument()
    })

    it('calls onCorridorChange with the selected id when a corridor is picked', () => {
      const { onCorridorChange } = renderChips()
      fireEvent.change(screen.getByTestId('filter-chip-corridor'), { target: { value: 'mesa' } })
      expect(onCorridorChange).toHaveBeenCalledWith('mesa')
    })

    it('calls onCorridorChange(null) when "All corridors" is picked', () => {
      const { onCorridorChange } = renderChips({ corridor: 'waterfront' })
      fireEvent.change(screen.getByTestId('filter-chip-corridor'), { target: { value: '' } })
      expect(onCorridorChange).toHaveBeenCalledWith(null)
    })

    it('clicking the × clears the corridor without stepping through the dropdown', () => {
      const { onCorridorChange } = renderChips({ corridor: 'mesa' })
      fireEvent.click(screen.getByTestId('filter-chip-corridor-clear'))
      expect(onCorridorChange).toHaveBeenCalledWith(null)
    })

    it('Reset link appears when only the corridor filter is active', () => {
      renderChips({ corridor: 'waterfront' })
      expect(screen.getByTestId('filter-chip-reset')).toBeInTheDocument()
    })
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
