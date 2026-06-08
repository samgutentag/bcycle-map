import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import NetworkPicker from './NetworkPicker'
import { SystemContextTestHarness } from '../context/SystemContext'
import { renderWithTheme } from '../test-utils'

const two = [
  { systemId: 'bcycle_santabarbara', name: 'Santa Barbara BCycle', gbfsUrl: '', rentalUrl: null, timezone: 'UTC', centroid: [0, 0] as [number, number], bbox: [0, 0, 0, 0] as [number, number, number, number], stationCount: 1 },
  { systemId: 'bcycle_cincyredbike', name: 'Red Bike - Cincinnati', gbfsUrl: '', rentalUrl: null, timezone: 'UTC', centroid: [0, 0] as [number, number], bbox: [0, 0, 0, 0] as [number, number, number, number], stationCount: 1 },
]

function renderWithSystems(value: Parameters<typeof SystemContextTestHarness>[0]['value']) {
  return renderWithTheme(
    <SystemContextTestHarness value={value}>
      <NetworkPicker />
    </SystemContextTestHarness>,
  )
}

describe('NetworkPicker', () => {
  it('renders nothing when fewer than 2 systems', () => {
    const { container } = renderWithSystems({ systemId: 'bcycle_santabarbara', systems: [two[0]!], activeSystem: two[0]!, setSystemId: vi.fn() })
    expect(container.querySelector('select')).toBeNull()
  })

  it('lists all systems and calls setSystemId on change', () => {
    const setSystemId = vi.fn()
    renderWithSystems({ systemId: 'bcycle_santabarbara', systems: two, activeSystem: two[0]!, setSystemId })
    const select = screen.getByTestId('network-picker') as HTMLSelectElement
    expect(select.value).toBe('bcycle_santabarbara')
    expect(screen.getByRole('option', { name: 'Red Bike - Cincinnati' })).toBeTruthy()
    fireEvent.change(select, { target: { value: 'bcycle_cincyredbike' } })
    expect(setSystemId).toHaveBeenCalledWith('bcycle_cincyredbike')
  })
})
