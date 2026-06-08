import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useCorridors } from './useCorridors'
import type { CorridorArtifact } from '@shared/corridors'

const ARTIFACT: CorridorArtifact = {
  generated_at: 1,
  source: 'derived',
  corridors: [{ id: 'north', label: 'North' }],
  assignments: { a: 'north' },
}

afterEach(() => vi.restoreAllMocks())

describe('useCorridors', () => {
  it('fetches the corridor artifact for the system from R2', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(ARTIFACT), { status: 200 }))
    const { result } = renderHook(() => useCorridors('https://r2.example', 'sys'))
    await waitFor(() => expect(result.current.data).not.toBeNull())
    expect(spy).toHaveBeenCalledWith('https://r2.example/gbfs/sys/corridors.json')
    expect(result.current.data!.corridors).toEqual([{ id: 'north', label: 'North' }])
  })

  it('returns null data (not an error) when the artifact is missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not found', { status: 404 }))
    const { result } = renderHook(() => useCorridors('https://r2.example', 'sys'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toBeNull()
  })
})
