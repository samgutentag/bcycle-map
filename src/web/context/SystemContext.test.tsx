import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { SystemProvider, useSystem, SYSTEM_LS_KEY, resolveActiveSystem } from './SystemContext'
import type { SystemsResponse } from '../lib/systems-api'

const RESP: SystemsResponse = {
  systems: [
    { systemId: 'bcycle_santabarbara', name: 'SB', gbfsUrl: '', rentalUrl: null, timezone: 'UTC', centroid: [-119.7, 34.42], bbox: [0,0,0,0], stationCount: 1 },
    { systemId: 'bcycle_cincyredbike', name: 'Cincy', gbfsUrl: '', rentalUrl: null, timezone: 'UTC', centroid: [-84.51, 39.10], bbox: [0,0,0,0], stationCount: 1 },
  ],
  nearestId: 'bcycle_cincyredbike',
}

describe('resolveActiveSystem (pure)', () => {
  const ids = ['bcycle_santabarbara', 'bcycle_cincyredbike']
  it('prefers a persisted pick that is still valid', () => {
    expect(resolveActiveSystem({ persisted: 'bcycle_cincyredbike', nearestId: 'bcycle_santabarbara', ids, fallback: 'bcycle_santabarbara' })).toBe('bcycle_cincyredbike')
  })
  it('ignores a persisted pick no longer in the list', () => {
    expect(resolveActiveSystem({ persisted: 'gone', nearestId: 'bcycle_cincyredbike', ids, fallback: 'bcycle_santabarbara' })).toBe('bcycle_cincyredbike')
  })
  it('falls back to nearest, then first, then default', () => {
    expect(resolveActiveSystem({ persisted: null, nearestId: 'bcycle_cincyredbike', ids, fallback: 'bcycle_santabarbara' })).toBe('bcycle_cincyredbike')
    expect(resolveActiveSystem({ persisted: null, nearestId: null, ids, fallback: 'bcycle_santabarbara' })).toBe('bcycle_santabarbara')
    expect(resolveActiveSystem({ persisted: null, nearestId: null, ids: [], fallback: 'bcycle_santabarbara' })).toBe('bcycle_santabarbara')
  })
})

function Probe() {
  const { systemId, systems } = useSystem()
  return <div data-testid="probe">{systemId}|{systems.length}</div>
}

describe('SystemProvider', () => {
  beforeEach(() => { window.localStorage.clear() })
  afterEach(() => { vi.restoreAllMocks() })

  it('resolves to nearest on first load and renders children immediately with the default', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(RESP), { status: 200 }))
    render(<SystemProvider defaultSystemId="bcycle_santabarbara"><Probe /></SystemProvider>)
    expect(screen.getByTestId('probe').textContent).toMatch(/^bcycle_santabarbara\|/)
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('bcycle_cincyredbike|2'))
    expect(window.localStorage.getItem(SYSTEM_LS_KEY)).toBe('bcycle_cincyredbike')
  })

  it('honors a persisted pick over nearest', async () => {
    window.localStorage.setItem(SYSTEM_LS_KEY, 'bcycle_santabarbara')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(RESP), { status: 200 }))
    render(<SystemProvider defaultSystemId="bcycle_santabarbara"><Probe /></SystemProvider>)
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('bcycle_santabarbara|2'))
  })

  it('keeps the default when the fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    render(<SystemProvider defaultSystemId="bcycle_santabarbara"><Probe /></SystemProvider>)
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('bcycle_santabarbara|0'))
  })
})
