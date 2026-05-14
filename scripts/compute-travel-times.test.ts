import { describe, it, expect } from 'vitest'
import {
  haversineMeters,
  diffStations,
  pairsToRecompute,
  allPairs,
  mergeEdges,
  chunk,
  googleDistanceMatrixBatch,
  computeDistanceMatrix,
  type Station,
} from './compute-travel-times'

describe('haversineMeters', () => {
  it('returns ~111km per degree of latitude', () => {
    const d = haversineMeters(34, -119, 35, -119)
    expect(d).toBeGreaterThan(110_000)
    expect(d).toBeLessThan(112_000)
  })

  it('returns near-zero for the same point', () => {
    expect(haversineMeters(34.42, -119.7, 34.42, -119.7)).toBeLessThan(0.001)
  })
})

describe('diffStations', () => {
  const a: Station = { id: 'a', lat: 34.42, lon: -119.7 }
  const b: Station = { id: 'b', lat: 34.43, lon: -119.71 }

  it('flags new stations as added', () => {
    const result = diffStations([a], [a, b])
    expect(result.added.map(s => s.id)).toEqual(['b'])
    expect(result.moved).toEqual([])
    expect(result.removed).toEqual([])
  })

  it('flags vanished stations as removed', () => {
    const result = diffStations([a, b], [a])
    expect(result.removed.map(s => s.id)).toEqual(['b'])
  })

  it('flags significant relocations as moved', () => {
    const aMoved: Station = { id: 'a', lat: 34.43, lon: -119.7 }  // ~1km north
    const result = diffStations([a], [aMoved])
    expect(result.moved.map(s => s.id)).toEqual(['a'])
  })

  it('ignores tiny shifts under the threshold', () => {
    // ~22m east — under default 50m threshold
    const aJiggled: Station = { id: 'a', lat: 34.42, lon: -119.6998 }
    const result = diffStations([a], [aJiggled])
    expect(result.moved).toEqual([])
  })

  it('respects a custom threshold', () => {
    const aJiggled: Station = { id: 'a', lat: 34.42, lon: -119.6998 }
    const result = diffStations([a], [aJiggled], 10)
    expect(result.moved.map(s => s.id)).toEqual(['a'])
  })
})

describe('pairsToRecompute', () => {
  const a: Station = { id: 'a', lat: 0, lon: 0 }
  const b: Station = { id: 'b', lat: 0, lon: 1 }
  const c: Station = { id: 'c', lat: 1, lon: 0 }

  it('returns empty when no changes', () => {
    const result = pairsToRecompute([a, b, c], { added: [], moved: [], removed: [] })
    expect(result).toEqual([])
  })

  it('returns every pair touching an added station', () => {
    const result = pairsToRecompute([a, b, c], { added: [c], moved: [], removed: [] })
    expect(result.length).toBe(4)
    const ids = new Set(result.map(([from, to]) => `${from.id}->${to.id}`))
    expect(ids).toEqual(new Set(['c->a', 'c->b', 'a->c', 'b->c']))
  })

  it('returns every pair touching a moved station', () => {
    const result = pairsToRecompute([a, b, c], { added: [], moved: [b], removed: [] })
    expect(result.length).toBe(4)
  })
})

describe('allPairs', () => {
  it('returns N * (N-1) directed pairs', () => {
    const stations: Station[] = [
      { id: 'a', lat: 0, lon: 0 },
      { id: 'b', lat: 0, lon: 1 },
      { id: 'c', lat: 1, lon: 0 },
    ]
    const result = allPairs(stations)
    expect(result.length).toBe(6)
  })
})

describe('mergeEdges', () => {
  const existing = {
    a: { b: { minutes: 5, meters: 1000 }, c: { minutes: 10, meters: 2000 } },
    b: { a: { minutes: 5, meters: 1000 } },
  }

  it('overlays updates on top of existing', () => {
    const updates = [{ from: 'a', to: 'b', edge: { minutes: 7, meters: 1200 } }]
    const result = mergeEdges(existing, updates, new Set())
    expect(result.a!.b).toEqual({ minutes: 7, meters: 1200 })
    expect(result.a!.c).toEqual({ minutes: 10, meters: 2000 })
  })

  it('drops edges touching removed stations', () => {
    const result = mergeEdges(existing, [], new Set(['c']))
    expect(result.a!.c).toBeUndefined()
    expect(result.a!.b).toBeDefined()
  })
})

describe('chunk', () => {
  it('splits an array into fixed-size pieces', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('returns an empty array when input is empty', () => {
    expect(chunk([], 5)).toEqual([])
  })

  it('returns one chunk when size exceeds length', () => {
    expect(chunk([1, 2, 3], 10)).toEqual([[1, 2, 3]])
  })
})

describe('googleDistanceMatrixBatch', () => {
  const a: Station = { id: 'a', lat: 0, lon: 0 }
  const b: Station = { id: 'b', lat: 0, lon: 1 }

  it('parses a 2x2 response and skips self-pairs', async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({
      status: 'OK',
      rows: [
        { elements: [
          { status: 'OK', duration: { value: 0 }, distance: { value: 0 } },       // a->a (self, skipped)
          { status: 'OK', duration: { value: 240 }, distance: { value: 1200 } },  // a->b
        ]},
        { elements: [
          { status: 'OK', duration: { value: 300 }, distance: { value: 1500 } },  // b->a
          { status: 'OK', duration: { value: 0 }, distance: { value: 0 } },       // b->b (self, skipped)
        ]},
      ],
    }), { status: 200 })) as typeof fetch
    const results = await googleDistanceMatrixBatch([a, b], [a, b], 'fake-key', fakeFetch)
    expect(results).toHaveLength(2)
    expect(results.find(r => r.from === 'a' && r.to === 'b')?.edge).toEqual({ minutes: 4, meters: 1200 })
    expect(results.find(r => r.from === 'b' && r.to === 'a')?.edge).toEqual({ minutes: 5, meters: 1500 })
  })

  it('rounds minutes to one decimal place', async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({
      status: 'OK',
      rows: [{ elements: [
        { status: 'OK', duration: { value: 215 }, distance: { value: 1000 } },  // 215s = 3.5833... → 3.6
      ]}],
    }), { status: 200 })) as typeof fetch
    const results = await googleDistanceMatrixBatch([a], [b], 'fake-key', fakeFetch)
    expect(results[0]!.edge.minutes).toBe(3.6)
  })

  it('skips elements with non-OK status', async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({
      status: 'OK',
      rows: [{ elements: [
        { status: 'ZERO_RESULTS' },
        { status: 'OK', duration: { value: 120 }, distance: { value: 500 } },
      ]}],
    }), { status: 200 })) as typeof fetch
    const c: Station = { id: 'c', lat: 0, lon: 2 }
    const results = await googleDistanceMatrixBatch([a], [b, c], 'fake-key', fakeFetch)
    expect(results).toHaveLength(1)
    expect(results[0]!.to).toBe('c')
  })

  it('throws on non-OK top-level status', async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({
      status: 'OVER_QUERY_LIMIT',
      rows: [],
    }), { status: 200 })) as typeof fetch
    await expect(
      googleDistanceMatrixBatch([a], [b], 'fake-key', fakeFetch),
    ).rejects.toThrow(/OVER_QUERY_LIMIT/)
  })

  it('throws when origins exceed the per-request cap', async () => {
    const tooMany: Station[] = Array.from({ length: 26 }, (_, i) => ({ id: `s${i}`, lat: 0, lon: i }))
    await expect(
      googleDistanceMatrixBatch(tooMany, [a], 'fake-key', (async () => new Response('{}')) as typeof fetch),
    ).rejects.toThrow(/origins exceeds limit/)
  })

  it('throws when total elements exceed the per-request cap', async () => {
    // 25 origins × 5 destinations = 125, over the 100 cap
    const origins: Station[] = Array.from({ length: 25 }, (_, i) => ({ id: `o${i}`, lat: 0, lon: i }))
    const dests: Station[] = Array.from({ length: 5 }, (_, i) => ({ id: `d${i}`, lat: 1, lon: i }))
    await expect(
      googleDistanceMatrixBatch(origins, dests, 'fake-key', (async () => new Response('{}')) as typeof fetch),
    ).rejects.toThrow(/elements exceeds limit/)
  })

  it('returns empty for zero-size inputs', async () => {
    const results = await googleDistanceMatrixBatch([], [a], 'fake-key', (async () => new Response('{}')) as typeof fetch)
    expect(results).toEqual([])
  })

  it('encodes bicycling mode in the request URL', async () => {
    let capturedUrl = ''
    const fakeFetch = (async (url: string) => {
      capturedUrl = url
      return new Response(JSON.stringify({
        status: 'OK',
        rows: [{ elements: [{ status: 'OK', duration: { value: 60 }, distance: { value: 200 } }] }],
      }), { status: 200 })
    }) as typeof fetch
    await googleDistanceMatrixBatch([a], [b], 'fake-key', fakeFetch)
    expect(capturedUrl).toContain('mode=bicycling')
    expect(capturedUrl).toContain('origins=0,0')
    expect(capturedUrl).toContain('destinations=0,1')
    expect(capturedUrl).toContain('key=fake-key')
  })
})

describe('computeDistanceMatrix', () => {
  it('tiles input into multiple API calls and aggregates results', async () => {
    // 30 origins × 8 destinations = 240 elements
    // Tiles at 25×4: 2 origin-chunks (25 + 5) × 2 dest-chunks (4 + 4) = 4 calls
    const origins: Station[] = Array.from({ length: 30 }, (_, i) => ({ id: `o${i}`, lat: 0, lon: i }))
    const dests: Station[] = Array.from({ length: 8 }, (_, i) => ({ id: `d${i}`, lat: 1, lon: i }))
    let callCount = 0
    const fakeFetch = (async (url: string) => {
      callCount++
      const u = new URL(url)
      const numOrigins = u.searchParams.get('origins')!.split('|').length
      const numDests = u.searchParams.get('destinations')!.split('|').length
      const rows = Array.from({ length: numOrigins }, () => ({
        elements: Array.from({ length: numDests }, () => ({
          status: 'OK', duration: { value: 60 }, distance: { value: 100 },
        })),
      }))
      return new Response(JSON.stringify({ status: 'OK', rows }), { status: 200 })
    }) as typeof fetch

    const results = await computeDistanceMatrix(origins, dests, 'fake-key', { fetchImpl: fakeFetch, delayMs: 0 })
    expect(callCount).toBe(4)
    expect(results).toHaveLength(30 * 8)  // no self-pairs to skip (disjoint ids)
  })

  it('reports progress on each call', async () => {
    const origins: Station[] = Array.from({ length: 25 }, (_, i) => ({ id: `o${i}`, lat: 0, lon: i }))
    const dests: Station[] = Array.from({ length: 8 }, (_, i) => ({ id: `d${i}`, lat: 1, lon: i }))
    // 25 × 8 = 200 elements → 1 origin-chunk × 2 dest-chunks = 2 calls
    const fakeFetch = (async (url: string) => {
      const u = new URL(url)
      const numOrigins = u.searchParams.get('origins')!.split('|').length
      const numDests = u.searchParams.get('destinations')!.split('|').length
      return new Response(JSON.stringify({
        status: 'OK',
        rows: Array.from({ length: numOrigins }, () => ({
          elements: Array.from({ length: numDests }, () => ({
            status: 'OK', duration: { value: 60 }, distance: { value: 100 },
          })),
        })),
      }), { status: 200 })
    }) as typeof fetch

    const progress: Array<[number, number]> = []
    await computeDistanceMatrix(origins, dests, 'fake-key', {
      fetchImpl: fakeFetch,
      delayMs: 0,
      onProgress: (done, total) => progress.push([done, total]),
    })
    expect(progress).toEqual([[1, 2], [2, 2]])
  })
})
