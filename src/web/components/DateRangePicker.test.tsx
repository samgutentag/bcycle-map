import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import DateRangePicker from './DateRangePicker'
import { renderWithTheme } from '../test-utils'

describe('DateRangePicker', () => {
  it('renders the four preset chips', () => {
    renderWithTheme(<DateRangePicker value="24h" onChange={() => {}} />)
    expect(screen.getByText('24h')).toBeInTheDocument()
    expect(screen.getByText('7d')).toBeInTheDocument()
    expect(screen.getByText('30d')).toBeInTheDocument()
    expect(screen.getByText('All')).toBeInTheDocument()
  })

  it('marks the currently-selected preset as checked', () => {
    renderWithTheme(<DateRangePicker value="7d" onChange={() => {}} />)
    // Harmony's SegmentedControl renders options as radio buttons.
    const sevenDay = screen.getByRole('radio', { name: '7d' })
    const oneDay = screen.getByRole('radio', { name: '24h' })
    expect(sevenDay).toBeChecked()
    expect(oneDay).not.toBeChecked()
  })

  it('calls onChange when a different preset is clicked', () => {
    const onChange = vi.fn()
    renderWithTheme(<DateRangePicker value="24h" onChange={onChange} />)
    // SegmentedControl exposes each option as a radio input; click that
    // rather than the text label so React's change handler fires.
    fireEvent.click(screen.getByRole('radio', { name: '30d' }))
    expect(onChange).toHaveBeenCalledWith('30d')
  })
})
