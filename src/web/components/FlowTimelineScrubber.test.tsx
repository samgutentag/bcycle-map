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
})
