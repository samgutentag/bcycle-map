import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DateRangePicker from './DateRangePicker'

describe('DateRangePicker', () => {
  it('renders the four preset chips', () => {
    render(<DateRangePicker value="24h" onChange={() => {}} />)
    expect(screen.getByText('24h')).toBeInTheDocument()
    expect(screen.getByText('7d')).toBeInTheDocument()
    expect(screen.getByText('30d')).toBeInTheDocument()
    expect(screen.getByText('All')).toBeInTheDocument()
  })

  it('highlights the currently-selected preset', () => {
    render(<DateRangePicker value="7d" onChange={() => {}} />)
    const seven = screen.getByText('7d').closest('button')
    const day = screen.getByText('24h').closest('button')
    expect(seven?.className).toMatch(/bg-/)
    expect(day?.className).not.toEqual(seven?.className)
  })

  it('calls onChange when a different preset is clicked', () => {
    const onChange = vi.fn()
    render(<DateRangePicker value="24h" onChange={onChange} />)
    fireEvent.click(screen.getByText('30d'))
    expect(onChange).toHaveBeenCalledWith('30d')
  })
})
