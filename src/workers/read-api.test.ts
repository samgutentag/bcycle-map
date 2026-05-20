import { describe, it, expect, vi, afterEach } from 'vitest'
import worker from './read-api'
import type { Env } from '../../worker-configuration'

function makeEnv({
  latestValue = null,
  r2Objects = [] as Array<{ key: string }>,
  r2Get = null as Record<string, string> | null,
  googleMapsApiKey,
}: {
  latestValue?: string | null
  r2Objects?: Array<{ key: string }>
  r2Get?: Record<string, string> | null
  googleMapsApiKey?: string
} = {}): Env {
  return {
    GBFS_KV: { get: vi.fn(async (_: string) => latestValue) } as any,
    GBFS_R2: {
      list: vi.fn(async (_: any) => ({
        objects: r2Objects,
        truncated: false,
        cursor: undefined,
      })),
      get: vi.fn(async (key: string) => {
        const val = r2Get?.[key]
        if (val == null) return null
        return { text: async () => val } as any
      }),
    } as any,
    GOOGLE_MAPS_API_KEY: googleMapsApiKey,
  }
}

describe('read-api', () => {
  it('returns 404 for unknown system', async () => {
    const env = makeEnv()
    const res = await worker.fetch(
      new Request('https://example/api/systems/unknown/current'),
      env,
    )
    expect(res.status).toBe(404)
  })

  it('returns latest JSON with CORS + cache headers', async () => {
    const payload = JSON.stringify({
      system: { system_id: 'bcycle_santabarbara' },
      snapshot_ts: 1,
      stations: [],
    })
    const env = makeEnv({ latestValue: payload })
    const res = await worker.fetch(
      new Request('https://example/api/systems/bcycle_santabarbara/current'),
      env,
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/json/)
    expect(res.headers.get('access-control-allow-origin')).toBeTruthy()
    expect(res.headers.get('cache-control')).toMatch(/max-age=60/)
    expect(await res.text()).toBe(payload)
  })

  it('returns 404 for unknown route', async () => {
    const env = makeEnv()
    const res = await worker.fetch(new Request('https://example/'), env)
    expect(res.status).toBe(404)
  })

  it('returns the keys of R2 partitions overlapping the requested range', async () => {
    // Hour 12 UTC on 2026-05-13 = 1778760000 (use exact)
    const hour12 = Math.floor(Date.UTC(2026, 4, 13, 12) / 1000)
    const hour13 = hour12 + 3600
    const hour20 = hour12 + 8 * 3600
    const env = makeEnv({
      r2Objects: [
        { key: 'gbfs/bcycle_santabarbara/station_status/dt=2026-05-13/12.parquet' },
        { key: 'gbfs/bcycle_santabarbara/station_status/dt=2026-05-13/13.parquet' },
        { key: 'gbfs/bcycle_santabarbara/station_status/dt=2026-05-13/20.parquet' },
        { key: 'gbfs/bcycle_santabarbara/station_information.parquet' },  // ignored
      ],
    })
    const url = `https://example/api/systems/bcycle_santabarbara/partitions?from=${hour12}&to=${hour13}`
    const res = await worker.fetch(new Request(url), env)
    expect(res.status).toBe(200)
    const body = await res.json() as { keys: string[] }
    expect(body.keys).toContain('gbfs/bcycle_santabarbara/station_status/dt=2026-05-13/12.parquet')
    expect(body.keys).toContain('gbfs/bcycle_santabarbara/station_status/dt=2026-05-13/13.parquet')
    // Hour 20 is outside the range (with 1h grace) — must not be present
    expect(body.keys).not.toContain('gbfs/bcycle_santabarbara/station_status/dt=2026-05-13/20.parquet')
    // The non-matching key should be filtered out
    expect(body.keys.every(k => /\d{2}\.parquet$/.test(k))).toBe(true)
    // The hour20 absence isn't a hard error since the regex variable is unused, satisfy TS:
    expect(hour20).toBe(hour20)
  })

  it('returns activity log from R2 with CORS + cache headers', async () => {
    const payload = JSON.stringify({
      events: [{ stationId: 'a', ts: 1, delta: -1 }],
      trips: [],
      inFlightFromStationId: null,
      inFlightDepartureTs: null,
    })
    const env = makeEnv({
      r2Get: { 'gbfs/bcycle_santabarbara/activity.json': payload },
    })
    const res = await worker.fetch(
      new Request('https://example/api/systems/bcycle_santabarbara/activity'),
      env,
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/json/)
    expect(res.headers.get('access-control-allow-origin')).toBeTruthy()
    expect(res.headers.get('cache-control')).toMatch(/max-age=20/)
    expect(await res.text()).toBe(payload)
  })

  it('falls back to empty activity log when R2 object is missing', async () => {
    const env = makeEnv()
    const res = await worker.fetch(
      new Request('https://example/api/systems/bcycle_santabarbara/activity'),
      env,
    )
    expect(res.status).toBe(200)
    const body = await res.json() as {
      events: unknown[]
      trips: unknown[]
      inFlightFromStationId: unknown
      inFlightDepartureTs: unknown
    }
    expect(body.events).toEqual([])
    expect(body.trips).toEqual([])
    expect(body.inFlightFromStationId).toBeNull()
    expect(body.inFlightDepartureTs).toBeNull()
  })

  // ─── Geocoding proxy ────────────────────────────────────────────────
  describe('geocoding proxy', () => {
    const realFetch = globalThis.fetch

    afterEach(() => {
      globalThis.fetch = realFetch
    })

    function stubGoogleResponse(body: unknown, ok = true) {
      globalThis.fetch = vi.fn(async () => ({
        ok,
        json: async () => body,
      })) as unknown as typeof globalThis.fetch
    }

    it('rejects an empty query as INVALID', async () => {
      const env = makeEnv({ googleMapsApiKey: 'test-key' })
      const res = await worker.fetch(
        new Request('https://example/api/geocode?q='),
        env,
      )
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'INVALID' })
    })

    it('rejects an overlong query as INVALID', async () => {
      const env = makeEnv({ googleMapsApiKey: 'test-key' })
      const q = 'a'.repeat(201)
      const res = await worker.fetch(
        new Request(`https://example/api/geocode?q=${q}`),
        env,
      )
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'INVALID' })
    })

    it('returns INVALID when GOOGLE_MAPS_API_KEY is missing', async () => {
      const env = makeEnv()
      const res = await worker.fetch(
        new Request('https://example/api/geocode?q=123+main+st'),
        env,
      )
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: 'INVALID' })
    })

    it('returns lat/lng/formatted on OK', async () => {
      stubGoogleResponse({
        status: 'OK',
        results: [
          {
            geometry: { location: { lat: 34.4208, lng: -119.6982 } },
            formatted_address: '101 State St, Santa Barbara, CA',
          },
        ],
      })
      const env = makeEnv({ googleMapsApiKey: 'test-key' })
      const res = await worker.fetch(
        new Request('https://example/api/geocode?q=101+state+st'),
        env,
      )
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch(/json/)
      expect(res.headers.get('access-control-allow-origin')).toBeTruthy()
      const body = await res.json() as { lat: number; lng: number; formatted: string }
      expect(body.lat).toBeCloseTo(34.4208, 4)
      expect(body.lng).toBeCloseTo(-119.6982, 4)
      expect(body.formatted).toMatch(/State St/)
    })

    it('surfaces ZERO_RESULTS as a 200 with an error payload', async () => {
      stubGoogleResponse({ status: 'ZERO_RESULTS', results: [] })
      const env = makeEnv({ googleMapsApiKey: 'test-key' })
      const res = await worker.fetch(
        new Request('https://example/api/geocode?q=nowhere'),
        env,
      )
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ error: 'ZERO_RESULTS' })
    })

    it('surfaces OVER_QUERY_LIMIT as OVER_QUOTA / 429', async () => {
      stubGoogleResponse({ status: 'OVER_QUERY_LIMIT' })
      const env = makeEnv({ googleMapsApiKey: 'test-key' })
      const res = await worker.fetch(
        new Request('https://example/api/geocode?q=anywhere'),
        env,
      )
      expect(res.status).toBe(429)
      expect(await res.json()).toEqual({ error: 'OVER_QUOTA' })
    })

    it('treats an upstream 5xx as INVALID', async () => {
      stubGoogleResponse({}, false)
      const env = makeEnv({ googleMapsApiKey: 'test-key' })
      const res = await worker.fetch(
        new Request('https://example/api/geocode?q=anywhere'),
        env,
      )
      expect(res.status).toBe(502)
      expect(await res.json()).toEqual({ error: 'INVALID' })
    })

    it('treats a missing location field as INVALID', async () => {
      stubGoogleResponse({ status: 'OK', results: [{ formatted_address: 'no geometry' }] })
      const env = makeEnv({ googleMapsApiKey: 'test-key' })
      const res = await worker.fetch(
        new Request('https://example/api/geocode?q=anywhere'),
        env,
      )
      expect(res.status).toBe(502)
      expect(await res.json()).toEqual({ error: 'INVALID' })
    })
  })
})
