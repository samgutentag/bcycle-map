import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import worker from './read-api'
import type { Env } from '../../worker-configuration'
import * as tripsLib from './lib/trips-from-parquet'

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

  // ─── Bulk trips endpoint (#53) ───────────────────────────────────────
  describe('bulk trips endpoint', () => {
    const sampleTrip = {
      departure_ts: 1000,
      arrival_ts: 1100,
      from_station_id: 'a',
      to_station_id: 'b',
      duration_sec: 100,
    }

    beforeEach(() => {
      vi.restoreAllMocks()
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('returns trips from the parquet archive for a valid window', async () => {
      const snapsSpy = vi.spyOn(tripsLib, 'readSnapshotsForRange').mockResolvedValue([
        { ts: 999, stations: [] },
      ])
      const tripsSpy = vi.spyOn(tripsLib, 'tripsFromSnapshots').mockReturnValue([sampleTrip])
      const env = makeEnv({
        latestValue: JSON.stringify({ max_bikes_ever: 50 }),
      })
      const res = await worker.fetch(
        new Request('https://example/api/systems/bcycle_santabarbara/trips?since=500&until=2000'),
        env,
      )
      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toMatch(/max-age=60/)
      expect(res.headers.get('access-control-allow-origin')).toBeTruthy()
      const body = await res.json() as { trips: typeof sampleTrip[]; since: number; until: number }
      expect(body.trips).toHaveLength(1)
      expect(body.trips[0]).toEqual(sampleTrip)
      expect(body.since).toBe(500)
      expect(body.until).toBe(2000)
      // max_bikes_ever from KV must flow into the trip-pairing call; matrix
      // arg is null here because no travel-times.json is stubbed (greedy
      // pass skipped, conservative-only output).
      expect(tripsSpy).toHaveBeenCalledWith(expect.anything(), 50, null)
      expect(snapsSpy).toHaveBeenCalledWith(env.GBFS_R2, 'bcycle_santabarbara', 500, 2000)
    })

    it('clips out trips whose departure falls outside the requested window', async () => {
      // partition reader includes a 1h pad; we only return trips strictly within [since, until]
      vi.spyOn(tripsLib, 'readSnapshotsForRange').mockResolvedValue([])
      vi.spyOn(tripsLib, 'tripsFromSnapshots').mockReturnValue([
        { ...sampleTrip, departure_ts: 400 },   // before window
        { ...sampleTrip, departure_ts: 1000 },  // in
        { ...sampleTrip, departure_ts: 3000 },  // after
      ])
      const env = makeEnv({ latestValue: JSON.stringify({ max_bikes_ever: 1 }) })
      const res = await worker.fetch(
        new Request('https://example/api/systems/bcycle_santabarbara/trips?since=500&until=2000'),
        env,
      )
      const body = await res.json() as { trips: typeof sampleTrip[] }
      expect(body.trips).toHaveLength(1)
      expect(body.trips[0]!.departure_ts).toBe(1000)
    })

    it('rejects a window with until <= since', async () => {
      const env = makeEnv()
      const res = await worker.fetch(
        new Request('https://example/api/systems/bcycle_santabarbara/trips?since=2000&until=1000'),
        env,
      )
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'until must be greater than since' })
    })

    it('rejects a window > 7 days', async () => {
      const env = makeEnv()
      const sevenDays = 7 * 86400
      const res = await worker.fetch(
        new Request(`https://example/api/systems/bcycle_santabarbara/trips?since=0&until=${sevenDays + 1}`),
        env,
      )
      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toMatch(/<= 604800/)
    })

    it('rejects missing/non-numeric since or until', async () => {
      const env = makeEnv()
      const res = await worker.fetch(
        new Request('https://example/api/systems/bcycle_santabarbara/trips'),
        env,
      )
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'since and until must be unix-second integers' })
    })

    it('returns 502 when the R2 parquet read throws', async () => {
      vi.spyOn(tripsLib, 'readSnapshotsForRange').mockRejectedValue(new Error('R2 down'))
      const env = makeEnv({ latestValue: JSON.stringify({ max_bikes_ever: 1 }) })
      const res = await worker.fetch(
        new Request('https://example/api/systems/bcycle_santabarbara/trips?since=500&until=2000'),
        env,
      )
      expect(res.status).toBe(502)
      expect(await res.json()).toEqual({ error: 'failed to read trip archive' })
    })

    it('still returns when KV latest is missing (cold start) — pairs with maxBikesEver=0', async () => {
      vi.spyOn(tripsLib, 'readSnapshotsForRange').mockResolvedValue([])
      const tripsSpy = vi.spyOn(tripsLib, 'tripsFromSnapshots').mockReturnValue([])
      const env = makeEnv()  // latestValue: null
      const res = await worker.fetch(
        new Request('https://example/api/systems/bcycle_santabarbara/trips?since=500&until=2000'),
        env,
      )
      expect(res.status).toBe(200)
      expect(tripsSpy).toHaveBeenCalledWith(expect.anything(), 0, null)
    })

    it('exposes a cache-control header for downstream CDN caching (~60s)', async () => {
      vi.spyOn(tripsLib, 'readSnapshotsForRange').mockResolvedValue([])
      vi.spyOn(tripsLib, 'tripsFromSnapshots').mockReturnValue([])
      const env = makeEnv({ latestValue: JSON.stringify({ max_bikes_ever: 10 }) })
      const res = await worker.fetch(
        new Request('https://example/api/systems/bcycle_santabarbara/trips?since=500&until=2000'),
        env,
      )
      // This is the cache layer the worker exposes — Cloudflare's edge cache
      // honors it without us having to touch the Cache API directly. Other
      // read-api endpoints use the same pattern.
      expect(res.headers.get('cache-control')).toBe('max-age=60')
    })

    it('reads travel-times.json from R2 and forwards the edges map to tripsFromSnapshots (#75)', async () => {
      // Bulk endpoint must load the same travel-time matrix the poller
      // uses so the greedy `inferTrips` pass can score candidates and
      // pair non-clean transitions. Without this, the endpoint returns
      // ~0 trips on a normal-volume day — see PR #74 revert in 3c825d8.
      vi.spyOn(tripsLib, 'readSnapshotsForRange').mockResolvedValue([])
      const tripsSpy = vi.spyOn(tripsLib, 'tripsFromSnapshots').mockReturnValue([])
      const matrixJson = JSON.stringify({
        computedAt: 1,
        edges: { a: { b: { minutes: 10, meters: 2500 } } },
      })
      const env = makeEnv({
        latestValue: JSON.stringify({ max_bikes_ever: 5 }),
        r2Get: { 'gbfs/bcycle_santabarbara/travel-times.json': matrixJson },
      })
      const res = await worker.fetch(
        new Request('https://example/api/systems/bcycle_santabarbara/trips?since=500&until=2000'),
        env,
      )
      expect(res.status).toBe(200)
      expect(env.GBFS_R2.get).toHaveBeenCalledWith('gbfs/bcycle_santabarbara/travel-times.json')
      // Third arg is the edges field only — `.computedAt` and `.stations` are
      // shaped for the web side and aren't part of SimpleMatrix.
      expect(tripsSpy).toHaveBeenCalledWith(
        expect.anything(),
        5,
        { a: { b: { minutes: 10, meters: 2500 } } },
      )
    })

    it('logs a warning and continues with matrix=null when travel-times.json is missing', async () => {
      // Matrix-missing must NOT 5xx — partial output (conservative-only
      // trips) is better than the whole request failing. Matches the
      // poller's matrix-missing branch.
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.spyOn(tripsLib, 'readSnapshotsForRange').mockResolvedValue([])
      const tripsSpy = vi.spyOn(tripsLib, 'tripsFromSnapshots').mockReturnValue([])
      const env = makeEnv({ latestValue: JSON.stringify({ max_bikes_ever: 5 }) })
      const res = await worker.fetch(
        new Request('https://example/api/systems/bcycle_santabarbara/trips?since=500&until=2000'),
        env,
      )
      expect(res.status).toBe(200)
      expect(tripsSpy).toHaveBeenCalledWith(expect.anything(), 5, null)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/travel-times\.json missing/),
      )
    })

    it('logs a warning and continues when travel-times.json fails to parse', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.spyOn(tripsLib, 'readSnapshotsForRange').mockResolvedValue([])
      const tripsSpy = vi.spyOn(tripsLib, 'tripsFromSnapshots').mockReturnValue([])
      const env = makeEnv({
        latestValue: JSON.stringify({ max_bikes_ever: 5 }),
        r2Get: { 'gbfs/bcycle_santabarbara/travel-times.json': 'not-valid-json{{' },
      })
      const res = await worker.fetch(
        new Request('https://example/api/systems/bcycle_santabarbara/trips?since=500&until=2000'),
        env,
      )
      expect(res.status).toBe(200)
      expect(tripsSpy).toHaveBeenCalledWith(expect.anything(), 5, null)
      expect(warnSpy).toHaveBeenCalled()
    })
  })

  // ─── Historical snapshots endpoint (#52) ─────────────────────────────
  describe('historical snapshots endpoint', () => {
    beforeEach(() => {
      vi.restoreAllMocks()
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    const sampleSnap = (ts: number) => ({
      ts,
      stations: [
        { station_id: 'a', num_bikes_available: 3, num_docks_available: 7 },
        { station_id: 'b', num_bikes_available: 1, num_docks_available: 9 },
      ],
    })

    it('returns downsampled snapshots from the parquet archive', async () => {
      const dockSpy = vi.spyOn(tripsLib, 'readDockSnapshotsForRange').mockResolvedValue([
        sampleSnap(1000),
        sampleSnap(1060),  // dropped by 120s step
        sampleSnap(1120),  // kept (≥ 120 past 1000)
        sampleSnap(1800),  // kept (last, always bookend)
      ])
      const env = makeEnv()
      const res = await worker.fetch(
        new Request('https://example/api/systems/bcycle_santabarbara/snapshots?since=1000&until=1800&step=120'),
        env,
      )
      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toBe('max-age=600')
      expect(res.headers.get('access-control-allow-origin')).toBeTruthy()
      const body = await res.json() as {
        snapshots: Array<{ ts: number; stations: unknown[] }>
        since: number
        until: number
        step: number
      }
      expect(body.since).toBe(1000)
      expect(body.until).toBe(1800)
      expect(body.step).toBe(120)
      expect(body.snapshots.map(s => s.ts)).toEqual([1000, 1120, 1800])
      expect(dockSpy).toHaveBeenCalledWith(env.GBFS_R2, 'bcycle_santabarbara', 1000, 1800)
    })

    it('preserves num_bikes_available + num_docks_available per station', async () => {
      vi.spyOn(tripsLib, 'readDockSnapshotsForRange').mockResolvedValue([sampleSnap(1000)])
      const env = makeEnv()
      const res = await worker.fetch(
        new Request('https://example/api/systems/bcycle_santabarbara/snapshots?since=900&until=2000&step=120'),
        env,
      )
      const body = await res.json() as {
        snapshots: Array<{ stations: Array<{ station_id: string; num_bikes_available: number; num_docks_available: number }> }>
      }
      const a = body.snapshots[0]!.stations.find(s => s.station_id === 'a')!
      expect(a.num_bikes_available).toBe(3)
      expect(a.num_docks_available).toBe(7)
    })

    it('defaults step to 120s when omitted', async () => {
      vi.spyOn(tripsLib, 'readDockSnapshotsForRange').mockResolvedValue([sampleSnap(1000)])
      const env = makeEnv()
      const res = await worker.fetch(
        new Request('https://example/api/systems/bcycle_santabarbara/snapshots?since=1000&until=2000'),
        env,
      )
      const body = await res.json() as { step: number }
      expect(body.step).toBe(120)
    })

    it('clips snapshots whose ts falls outside the requested window', async () => {
      vi.spyOn(tripsLib, 'readDockSnapshotsForRange').mockResolvedValue([
        sampleSnap(400),    // before window — partition pad
        sampleSnap(1000),   // in
        sampleSnap(2000),   // in (bookend)
        sampleSnap(3000),   // after — partition pad
      ])
      const env = makeEnv()
      const res = await worker.fetch(
        new Request('https://example/api/systems/bcycle_santabarbara/snapshots?since=1000&until=2000&step=120'),
        env,
      )
      const body = await res.json() as { snapshots: Array<{ ts: number }> }
      expect(body.snapshots.map(s => s.ts)).toEqual([1000, 2000])
    })

    it('rejects until <= since', async () => {
      const env = makeEnv()
      const res = await worker.fetch(
        new Request('https://example/api/systems/bcycle_santabarbara/snapshots?since=2000&until=1000&step=120'),
        env,
      )
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'until must be greater than since' })
    })

    it('rejects a window > 7 days', async () => {
      const env = makeEnv()
      const sevenDays = 7 * 86400
      const res = await worker.fetch(
        new Request(`https://example/api/systems/bcycle_santabarbara/snapshots?since=0&until=${sevenDays + 1}&step=120`),
        env,
      )
      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toMatch(/<= 604800/)
    })

    it('rejects step < 60', async () => {
      const env = makeEnv()
      const res = await worker.fetch(
        new Request('https://example/api/systems/bcycle_santabarbara/snapshots?since=1000&until=2000&step=30'),
        env,
      )
      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toMatch(/step must be between 60 and 3600/)
    })

    it('rejects step > 3600', async () => {
      const env = makeEnv()
      const res = await worker.fetch(
        new Request('https://example/api/systems/bcycle_santabarbara/snapshots?since=1000&until=2000&step=9999'),
        env,
      )
      expect(res.status).toBe(400)
    })

    it('rejects missing/non-numeric since or until', async () => {
      const env = makeEnv()
      const res = await worker.fetch(
        new Request('https://example/api/systems/bcycle_santabarbara/snapshots'),
        env,
      )
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'since and until must be unix-second integers' })
    })

    it('returns 502 when the R2 parquet read throws', async () => {
      vi.spyOn(tripsLib, 'readDockSnapshotsForRange').mockRejectedValue(new Error('R2 down'))
      const env = makeEnv()
      const res = await worker.fetch(
        new Request('https://example/api/systems/bcycle_santabarbara/snapshots?since=500&until=2000&step=120'),
        env,
      )
      expect(res.status).toBe(502)
      expect(await res.json()).toEqual({ error: 'failed to read snapshot archive' })
    })

    it('exposes a cache-control header for aggressive CDN caching (~600s)', async () => {
      vi.spyOn(tripsLib, 'readDockSnapshotsForRange').mockResolvedValue([])
      const env = makeEnv()
      const res = await worker.fetch(
        new Request('https://example/api/systems/bcycle_santabarbara/snapshots?since=500&until=2000&step=120'),
        env,
      )
      // Data is immutable once written, so we cache more aggressively than
      // the trips endpoint (which re-derives every minute as new snapshots
      // land).
      expect(res.headers.get('cache-control')).toBe('max-age=600')
    })
  })
})
