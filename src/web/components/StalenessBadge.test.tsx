import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import StalenessBadge from './StalenessBadge'
import { renderWithTheme } from '../test-utils'

describe('StalenessBadge', () => {
  it('renders nothing when ageSec < 180', () => {
    // ThemeProvider injects an `<svg>` of icon defs at the container root, so
    // `container.firstChild` isn't null here even when the badge is hidden.
    // Assert on visible badge copy instead.
    renderWithTheme(<StalenessBadge ageSec={120} snapshotTs={1} />)
    expect(screen.queryByText(/ago|stale/i)).not.toBeInTheDocument()
  })

  it('renders a small badge when ageSec is 180-600', () => {
    renderWithTheme(<StalenessBadge ageSec={300} snapshotTs={1} />)
    expect(screen.getByText(/5m ago|300s/i)).toBeInTheDocument()
  })

  it('renders a prominent banner when ageSec > 600', () => {
    renderWithTheme(<StalenessBadge ageSec={1200} snapshotTs={1} />)
    expect(screen.getByText(/feed appears stale/i)).toBeInTheDocument()
  })
})
