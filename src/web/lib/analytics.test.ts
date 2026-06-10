import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { trackEvent, sendBeacon, getOrCreateSessionId } from './analytics'

describe('analytics', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchMock: any

  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
    vi.stubGlobal('fetch', fetchMock)
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('trackEvent posts an enriched event beacon with stringified props', () => {
    vi.stubEnv('DEV', false)
    trackEvent('route_check_run', { from: 'a', to: 'b', fromName: 'State St', count: 3 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toMatch(/\/api\/beacon$/)
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.type).toBe('event')
    expect(body.name).toBe('route_check_run')
    expect(body.props).toEqual({ from: 'a', to: 'b', fromName: 'State St', count: '3' })
    expect(body.session).toBeTruthy()
  })

  it('is skipped entirely in dev', () => {
    vi.stubEnv('DEV', true)
    trackEvent('station_opened', { stationId: 'x' })
    sendBeacon({ type: 'pageview', path: '/' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reuses a stable session id across calls', () => {
    vi.stubEnv('DEV', false)
    const a = getOrCreateSessionId()
    const b = getOrCreateSessionId()
    expect(a).toBe(b)
  })

  it('never throws when fetch rejects', () => {
    vi.stubEnv('DEV', false)
    fetchMock.mockImplementation(() => Promise.reject(new Error('network')))
    expect(() => trackEvent('flow_used', { action: 'scrub' })).not.toThrow()
  })
})
