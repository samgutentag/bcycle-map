import { describe, it, expect, vi } from 'vitest'
import { fetchJsonWithRetry } from './gbfs-client'

describe('fetchJsonWithRetry', () => {
  it('returns parsed JSON on first success', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    )
    const result = await fetchJsonWithRetry('http://example/', { fetchImpl: fetchFn })
    expect(result).toEqual({ ok: true })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('retries once on 5xx then succeeds', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response('boom', { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const result = await fetchJsonWithRetry('http://example/', { fetchImpl: fetchFn, backoffMs: 0 })
    expect(result).toEqual({ ok: true })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('throws after both attempts fail', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('boom', { status: 503 }))
    await expect(
      fetchJsonWithRetry('http://example/', { fetchImpl: fetchFn, backoffMs: 0 })
    ).rejects.toThrow(/503/)
  })
})
