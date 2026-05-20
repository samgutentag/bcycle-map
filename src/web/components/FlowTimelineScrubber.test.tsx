import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { renderWithTheme } from '../test-utils'
import FlowTimelineScrubber from './FlowTimelineScrubber'

afterEach(() => cleanup())

type Overrides = {
  cursorTs?: number
  windowStart?: number
  windowEnd?: number
  playing?: boolean
  caption?: string | null
}

const BASE_END = 1_700_000_000  // arbitrary anchor in the recent past
const BASE_START = BASE_END - 24 * 3600

function renderScrubber(overrides: Overrides = {}) {
  const onCursorChange = vi.fn()
  const onPlayToggle = vi.fn()
  renderWithTheme(
    <FlowTimelineScrubber
      cursorTs={overrides.cursorTs ?? BASE_END}
      windowStart={overrides.windowStart ?? BASE_START}
      windowEnd={overrides.windowEnd ?? BASE_END}
      playing={overrides.playing ?? false}
      onCursorChange={onCursorChange}
      onPlayToggle={onPlayToggle}
      caption={overrides.caption ?? null}
      timezone="UTC"
    />,
  )
  return { onCursorChange, onPlayToggle }
}

describe('FlowTimelineScrubber', () => {
  it('renders the play/pause toggle, scrubber, and Now button', () => {
    renderScrubber()
    expect(screen.getByTestId('flow-play-toggle')).toBeInTheDocument()
    expect(screen.getByTestId('flow-scrubber')).toBeInTheDocument()
    expect(screen.getByTestId('flow-jump-now')).toBeInTheDocument()
  })

  it('reflects the playing prop in the play toggle aria-pressed', () => {
    renderScrubber({ playing: true })
    expect(screen.getByTestId('flow-play-toggle')).toHaveAttribute('aria-pressed', 'true')
  })

  it('invokes onPlayToggle when the play button is clicked', () => {
    const { onPlayToggle } = renderScrubber()
    fireEvent.click(screen.getByTestId('flow-play-toggle'))
    expect(onPlayToggle).toHaveBeenCalledTimes(1)
  })

  it('invokes onCursorChange with windowEnd when Now is clicked', () => {
    const { onCursorChange } = renderScrubber({
      cursorTs: BASE_START + 3600,
      windowStart: BASE_START,
      windowEnd: BASE_END,
    })
    fireEvent.click(screen.getByTestId('flow-jump-now'))
    expect(onCursorChange).toHaveBeenLastCalledWith(BASE_END)
  })

  it('emits the new cursor value when the range input is changed', () => {
    const { onCursorChange } = renderScrubber()
    const slider = screen.getByTestId('flow-scrubber') as HTMLInputElement
    fireEvent.change(slider, { target: { value: String(BASE_START + 3600) } })
    expect(onCursorChange).toHaveBeenCalledWith(BASE_START + 3600)
  })

  it('renders the optional caption when provided', () => {
    renderScrubber({ caption: 'showing 80 of 134 trips' })
    expect(screen.getByText('showing 80 of 134 trips')).toBeInTheDocument()
  })

  it('omits the caption row when caption is null', () => {
    renderScrubber({ caption: null })
    expect(screen.queryByText(/showing/i)).toBeNull()
  })

  it('sets aria-valuemin / aria-valuemax / aria-valuenow on the scrubber', () => {
    renderScrubber({
      cursorTs: BASE_START + 7200,
      windowStart: BASE_START,
      windowEnd: BASE_END,
    })
    const slider = screen.getByTestId('flow-scrubber')
    expect(slider).toHaveAttribute('aria-valuemin', String(BASE_START))
    expect(slider).toHaveAttribute('aria-valuemax', String(BASE_END))
    expect(slider).toHaveAttribute('aria-valuenow', String(BASE_START + 7200))
  })

  // Adaptive tick density (#56): tick interval shrinks for narrow dynamic
  // windows so a ~2h scrubber doesn't render with one or zero ticks, and
  // the full 24h still gets sensible 3h spacing rather than 96 crowded ticks.
  describe('adaptive tick density', () => {
    function countTicks(start: number, end: number): number {
      renderScrubber({ windowStart: start, windowEnd: end, cursorTs: start })
      return screen.queryAllByTestId('flow-scrubber-tick').length
    }

    it('renders ~4 ticks on a 2h dynamic window (30min spacing)', () => {
      const end = BASE_END
      const start = end - 2 * 3600
      // 30-minute ticks across 2h → 4 or 5 ticks depending on alignment
      const count = countTicks(start, end)
      expect(count).toBeGreaterThanOrEqual(3)
      expect(count).toBeLessThanOrEqual(6)
    })

    it('renders ~8 ticks on the full 24h window (3h spacing)', () => {
      // 3-hour ticks across 24h → 8 or 9 ticks
      const count = countTicks(BASE_START, BASE_END)
      expect(count).toBeGreaterThanOrEqual(7)
      expect(count).toBeLessThanOrEqual(10)
    })

    it('renders multiple ticks on a narrow 30min window (15min spacing)', () => {
      const end = BASE_END
      const start = end - 30 * 60
      // 15-minute ticks across 30min → 2 or 3 ticks
      const count = countTicks(start, end)
      expect(count).toBeGreaterThanOrEqual(2)
      expect(count).toBeLessThanOrEqual(4)
    })

    it('renders ticks on a 6h medium window (1h spacing)', () => {
      const end = BASE_END
      const start = end - 6 * 3600
      // 1-hour ticks across 6h → 6 or 7 ticks
      const count = countTicks(start, end)
      expect(count).toBeGreaterThanOrEqual(5)
      expect(count).toBeLessThanOrEqual(8)
    })
  })
})
