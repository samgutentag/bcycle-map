import { describe, it, expect, vi } from 'vitest'
import { fileIssueIfNoneOpen } from './github'

describe('fileIssueIfNoneOpen', () => {
  it('does nothing if an open issue with the label already exists', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('/search/issues')) {
        return new Response(JSON.stringify({ items: [{ number: 5 }] }), { status: 200 })
      }
      return new Response('unexpected', { status: 500 })
    })
    await fileIssueIfNoneOpen({
      token: 't',
      repo: 'owner/repo',
      label: 'smoke-failure',
      title: 'Smoke failed',
      body: 'details',
      fetchImpl: fetchFn as any,
    })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('creates an issue when no open one exists', async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/search/issues')) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 })
      }
      if (url.endsWith('/issues') && init?.method === 'POST') {
        return new Response(JSON.stringify({ number: 42 }), { status: 201 })
      }
      return new Response('unexpected', { status: 500 })
    })
    const result = await fileIssueIfNoneOpen({
      token: 't',
      repo: 'owner/repo',
      label: 'smoke-failure',
      title: 'Smoke failed',
      body: 'details',
      fetchImpl: fetchFn as any,
    })
    expect(result?.number).toBe(42)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})
