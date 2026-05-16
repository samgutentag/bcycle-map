import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StationPicker from './StationPicker'
import type { StationSnapshot } from '@shared/types'

const STATIONS: StationSnapshot[] = [
  { station_id: 's1', name: 'Anacapa & Haley', lat: 0, lon: 0, address: '', num_bikes_available: 0, num_docks_available: 0, bikes_electric: 0, bikes_classic: 0, bikes_smart: 0, is_installed: true, is_renting: true, is_returning: true, last_reported: 0 },
  { station_id: 's2', name: 'Bath & Hope', lat: 0, lon: 0, address: '', num_bikes_available: 0, num_docks_available: 0, bikes_electric: 0, bikes_classic: 0, bikes_smart: 0, is_installed: true, is_renting: true, is_returning: true, last_reported: 0 },
  { station_id: 's3', name: 'Hope & State', lat: 0, lon: 0, address: '', num_bikes_available: 0, num_docks_available: 0, bikes_electric: 0, bikes_classic: 0, bikes_smart: 0, is_installed: true, is_renting: true, is_returning: true, last_reported: 0 },
  { station_id: 's4', name: 'State & Cota', lat: 0, lon: 0, address: '', num_bikes_available: 0, num_docks_available: 0, bikes_electric: 0, bikes_classic: 0, bikes_smart: 0, is_installed: true, is_renting: true, is_returning: true, last_reported: 0 },
]

function renderPicker(overrides: Partial<React.ComponentProps<typeof StationPicker>> = {}) {
  const onChange = vi.fn()
  const utils = render(
    <StationPicker label="Start" value={null} stations={STATIONS} onChange={onChange} {...overrides} />,
  )
  return { ...utils, onChange }
}

describe('StationPicker', () => {
  it('renders the placeholder when nothing is selected', () => {
    renderPicker()
    expect(screen.getByRole('combobox')).toHaveTextContent(/select a station/i)
  })

  it('renders the selected station name', () => {
    renderPicker({ value: 's3' })
    expect(screen.getByRole('combobox')).toHaveTextContent('Hope & State')
  })

  it('opens the panel and shows the full list on click', () => {
    renderPicker()
    fireEvent.click(screen.getByRole('combobox'))
    expect(screen.getByRole('searchbox')).toBeInTheDocument()
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(4)
    expect(options[0]).toHaveTextContent('Anacapa & Haley')
    expect(options[3]).toHaveTextContent('State & Cota')
  })

  it('filters options as the user types', () => {
    renderPicker()
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'hope' } })
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options[0]).toHaveTextContent('Bath & Hope')
    expect(options[1]).toHaveTextContent('Hope & State')
  })

  it('shows an empty state when no options match the filter', () => {
    renderPicker()
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } })
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText(/no matches/i)).toBeInTheDocument()
  })

  it('commits the selection on click and closes the panel', () => {
    const { onChange } = renderPicker()
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByText('Hope & State'))
    expect(onChange).toHaveBeenCalledWith('s3')
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  })

  it('selects the highlighted row on Enter', () => {
    const { onChange } = renderPicker()
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'hope' } })
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'ArrowDown' })
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('s3') // Hope & State (second after ArrowDown)
  })

  it('closes on Escape without committing', () => {
    const { onChange } = renderPicker()
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  })
})
