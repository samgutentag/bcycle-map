import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { renderWithTheme } from '../test-utils'
import FogToggle from './FogToggle'

afterEach(() => cleanup())

describe('FogToggle', () => {
  it('renders a switch button labelled Fog', () => {
    renderWithTheme(<FogToggle enabled={false} onToggle={() => {}} />)
    const btn = screen.getByTestId('fog-toggle')
    expect(btn).toHaveTextContent('Fog')
    expect(btn.getAttribute('role')).toBe('switch')
  })

  it('reports aria-checked=false when fog is off', () => {
    renderWithTheme(<FogToggle enabled={false} onToggle={() => {}} />)
    expect(screen.getByTestId('fog-toggle').getAttribute('aria-checked')).toBe('false')
  })

  it('reports aria-checked=true when fog is on', () => {
    renderWithTheme(<FogToggle enabled={true} onToggle={() => {}} />)
    expect(screen.getByTestId('fog-toggle').getAttribute('aria-checked')).toBe('true')
  })

  it('calls onToggle once per click', () => {
    const onToggle = vi.fn()
    renderWithTheme(<FogToggle enabled={false} onToggle={onToggle} />)
    fireEvent.click(screen.getByTestId('fog-toggle'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
