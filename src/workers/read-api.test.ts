import { describe, it, expect, vi } from 'vitest'
import worker from './read-api'
import type { Env } from '../../worker-configuration'

function makeEnv({
  latestValue = null,
  r2Objects = [] as Array<{ key: string }>,
}: { latestValue?: string | null; r2Objects?: Array<{ key: string }> } = {}): Env {
  return {
    GBFS_KV: { get: vi.fn(async (_: string) => latestValue) } as any,
    GBFS_R2: {
      list: vi.fn(async (_: any) => ({
        objects: r2Objects,
        truncated: false,
        cursor: undefined,
      })),
    } as any,
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
})
