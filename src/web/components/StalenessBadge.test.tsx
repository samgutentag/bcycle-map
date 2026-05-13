import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import StalenessBadge from './StalenessBadge'

describe('StalenessBadge', () => {
  it('renders nothing when ageSec < 180', () => {
    const { container } = render(<StalenessBadge ageSec={120} snapshotTs={1} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a small badge when ageSec is 180-600', () => {
    render(<StalenessBadge ageSec={300} snapshotTs={1} />)
    expect(screen.getByText(/5m ago|300s/i)).toBeInTheDocument()
  })

  it('renders a prominent banner when ageSec > 600', () => {
    render(<StalenessBadge ageSec={1200} snapshotTs={1} />)
    expect(screen.getByText(/feed appears stale/i)).toBeInTheDocument()
  })
})
