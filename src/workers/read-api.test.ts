import { describe, it, expect, vi } from 'vitest'
import worker from './read-api'
import type { Env } from '../../worker-configuration'

function makeEnv(latestValue: string | null): Env {
  return {
    GBFS_KV: { get: vi.fn(async (_: string) => latestValue) } as any,
    GBFS_R2: {} as any,
  }
}

describe('read-api', () => {
  it('returns 404 for unknown system', async () => {
    const env = makeEnv(null)
    const res = await worker.fetch(
      new Request('https://example/api/systems/unknown/current'),
      env
    )
    expect(res.status).toBe(404)
  })

  it('returns latest JSON with CORS + cache headers', async () => {
    const payload = JSON.stringify({
      system: { system_id: 'bcycle_santabarbara' },
      snapshot_ts: 1,
      stations: [],
    })
    const env = makeEnv(payload)
    const res = await worker.fetch(
      new Request('https://example/api/systems/bcycle_santabarbara/current'),
      env
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/json/)
    expect(res.headers.get('access-control-allow-origin')).toBeTruthy()
    expect(res.headers.get('cache-control')).toMatch(/max-age=60/)
    expect(await res.text()).toBe(payload)
  })

  it('returns 404 for unknown route', async () => {
    const env = makeEnv(null)
    const res = await worker.fetch(new Request('https://example/'), env)
    expect(res.status).toBe(404)
  })
})
