import { describe, it, expect, vi } from 'vitest'
import { runSmoke } from './smoke'

const sys = { system_id: 's', name: 'S', gbfs_url: 'http://x/gbfs.json', version: '1.1' }

describe('runSmoke', () => {
  it('does nothing when the feed normalizes successfully', async () => {
    const fileFn = vi.fn()
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/gbfs.json')) return new Response(JSON.stringify({
        data: { en: { feeds: [
          { name: 'station_information', url: 'http://x/station_information.json' },
          { name: 'station_status', url: 'http://x/station_status.json' },
          { name: 'system_information', url: 'http://x/system_information.json' },
        ] } }
      }))
      if (url.endsWith('/station_information.json')) return new Response(JSON.stringify({ data: { stations: [{ station_id: 'a', name: 'A', lat: 0, lon: 0 }] } }))
      if (url.endsWith('/station_status.json')) return new Response(JSON.stringify({ data: { stations: [{ station_id: 'a', num_bikes_available: 0, num_docks_available: 0, is_installed: 1, is_renting: 1, is_returning: 1, last_reported: 0 }] } }))
      if (url.endsWith('/system_information.json')) return new Response(JSON.stringify({ data: { system_id: 's', name: 'S', timezone: 'UTC', language: 'en' } }))
      return new Response('404', { status: 404 })
    })
    await runSmoke([sys], { fetchImpl: fetchFn as any, fileIssue: fileFn })
    expect(fileFn).not.toHaveBeenCalled()
  })

  it('files an issue when normalization throws', async () => {
    const fileFn = vi.fn()
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/gbfs.json')) return new Response(JSON.stringify({ data: { en: { feeds: [] } } }))
      return new Response('404', { status: 404 })
    })
    await runSmoke([sys], { fetchImpl: fetchFn as any, fileIssue: fileFn })
    expect(fileFn).toHaveBeenCalledTimes(1)
    const call = fileFn.mock.calls[0]![0]
    expect(call.label).toBe('smoke-failure')
    expect(call.title).toMatch(/smoke/i)
  })
})
