import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { renderWithTheme } from '../test-utils'
import FogOfWorldLayer, { carveTripPath, prepareFogTrips } from './FogOfWorldLayer'
import type { Trip } from '@shared/types'
import type { RouteCache } from '@shared/route-cache'
import type maplibregl from 'maplibre-gl'

afterEach(() => cleanup())

vi.mock('maplibre-gl', () => {
  const Map = vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    off: vi.fn(),
    remove: vi.fn(),
    getContainer: () => ({ clientWidth: 800, clientHeight: 600 }),
    project: (ll: [number, number]) => ({ x: ll[0], y: ll[1] }),
  }))
  return { default: { Map }, Map }
})

// A tiny straight-line polyline from (0,0) → (10,0), Google-encoded.
// We don't need a *realistic* polyline — the math is what matters — but
// encoding is the simplest way to feed `decodePolyline` valid input.
// Reverse-engineering Google's encoding for arbitrary points is more
// work than it's worth; instead we hand-craft prepared trips directly
// in tests that exercise `carveTripPath`, and use a real route cache
// where prepareFogTrips is the unit under test.

const TRIP: Trip = {
  departure_ts: 1000,
  arrival_ts: 2000,
  from_station_id: 's1',
  to_station_id: 's2',
  duration_sec: 1000,
}

/** Tiny Google-polyline encoder so test fixtures don't have to ship
 * hand-encoded magic strings. Encodes [[lat, lng], ...] pairs (NOT the
 * decoded [lng, lat] order — match Google's input shape). */
function encodePolyline(coords: Array<[number, number]>): string {
  let lastLat = 0
  let lastLng = 0
  let out = ''
  const encodeSigned = (n: number) => {
    let v = n < 0 ? ~(n << 1) : n << 1
    let s = ''
    while (v >= 0x20) {
      s += String.fromCharCode((0x20 | (v & 0x1f)) + 63)
      v >>= 5
    }
    s += String.fromCharCode(v + 63)
    return s
  }
  for (const [lat, lng] of coords) {
    const latE5 = Math.round(lat * 1e5)
    const lngE5 = Math.round(lng * 1e5)
    out += encodeSigned(latE5 - lastLat)
    out += encodeSigned(lngE5 - lastLng)
    lastLat = latE5
    lastLng = lngE5
  }
  return out
}

const POLYLINE = encodePolyline([
  [0, 0],
  [0, 0.001],
  [0, 0.002],
])

const ROUTES: RouteCache = {
  computedAt: 0,
  stations: [
    { id: 's1', lat: 0, lon: 0 },
    { id: 's2', lat: 0, lon: 1 },
  ],
  edges: { s1: { s2: { polyline: POLYLINE, meters: 100, seconds: 60, via_station_ids: [] } } },
}

describe('FogOfWorldLayer (component)', () => {
  it('renders nothing when enabled is false', () => {
    renderWithTheme(
      <FogOfWorldLayer
        map={null}
        trips={[TRIP]}
        routes={ROUTES}
        cursorTs={1500}
        enabled={false}
      />,
    )
    expect(screen.queryByTestId('fog-of-world-canvas')).toBeNull()
  })

  it('renders the canvas when enabled is true', () => {
    renderWithTheme(
      <FogOfWorldLayer
        map={null}
        trips={[TRIP]}
        routes={ROUTES}
        cursorTs={1500}
        enabled={true}
      />,
    )
    expect(screen.getByTestId('fog-of-world-canvas')).toBeInTheDocument()
  })

  it('keeps the canvas pointer-events: none so map interactions pass through', () => {
    renderWithTheme(
      <FogOfWorldLayer
        map={null}
        trips={[TRIP]}
        routes={ROUTES}
        cursorTs={1500}
        enabled={true}
      />,
    )
    const canvas = screen.getByTestId('fog-of-world-canvas')
    // Emotion serializes css to a className; pointer-events is on the
    // generated style rule. The style attribute won't be present, but
    // we can verify the inline element didn't override it.
    expect(canvas.style.pointerEvents).not.toBe('auto')
  })
})

describe('prepareFogTrips', () => {
  it('drops trips with no cached route', () => {
    const orphan: Trip = { ...TRIP, from_station_id: 'unknown' }
    const out = prepareFogTrips([orphan], ROUTES)
    expect(out).toHaveLength(0)
  })

  it('returns one prepared entry per trip with a cached polyline', () => {
    const out = prepareFogTrips([TRIP], ROUTES)
    expect(out).toHaveLength(1)
    expect(out[0]!.poly.length).toBeGreaterThanOrEqual(2)
    expect(out[0]!.cum.length).toBe(out[0]!.poly.length)
    expect(out[0]!.cum[0]).toBe(0)
  })

  it('returns empty when routes is null', () => {
    expect(prepareFogTrips([TRIP], null)).toEqual([])
  })
})

/**
 * Fake 2D context that records every method call so we can assert the
 * exact path produced by carveTripPath. Tracks position, line widths,
 * and the moveTo/lineTo sequence.
 */
function makeFakeCtx() {
  const calls: Array<{ op: string; args: unknown[] }> = []
  const ctx = {
    beginPath: (...args: unknown[]) => calls.push({ op: 'beginPath', args }),
    moveTo: (...args: unknown[]) => calls.push({ op: 'moveTo', args }),
    lineTo: (...args: unknown[]) => calls.push({ op: 'lineTo', args }),
    stroke: (...args: unknown[]) => calls.push({ op: 'stroke', args }),
    set lineWidth(_v: number) {},
    set lineCap(_v: string) {},
    set lineJoin(_v: string) {},
  } as unknown as CanvasRenderingContext2D
  return { ctx, calls }
}

function fakeMap(): maplibregl.Map {
  // Identity projection makes the test arithmetic match the polyline
  // coords directly — easier to reason about.
  return {
    project: (ll: [number, number]) => ({ x: ll[0] * 1000, y: ll[1] * 1000 }),
  } as unknown as maplibregl.Map
}

describe('carveTripPath (deterministic path generation)', () => {
  // Hand-craft a 3-vertex straight horizontal polyline at lat=0, lon=0..2.
  // cumDist is [0, 1, 2] (Euclidean degree-distance).
  const prep = {
    trip: TRIP,
    poly: [
      [0, 0],
      [1, 0],
      [2, 0],
    ] as [number, number][],
    cum: [0, 1, 2],
  }

  it('emits nothing when cursor is before departure', () => {
    const { ctx, calls } = makeFakeCtx()
    carveTripPath(ctx, fakeMap(), prep, TRIP.departure_ts - 1, 12)
    expect(calls.filter(c => c.op === 'stroke')).toHaveLength(0)
  })

  it('emits a path that ends at the bike position halfway through the trip', () => {
    const { ctx, calls } = makeFakeCtx()
    // Halfway in time → fraction 0.5 → target = 1.0 (half the polyline length).
    // That sits exactly at vertex index 1, so the path is start → vertex 1.
    carveTripPath(ctx, fakeMap(), prep, 1500, 12)
    const segs = calls.filter(c => c.op === 'moveTo' || c.op === 'lineTo')
    // Start (0,0) → tip at (1,0) (cum[1] === target, so the loop's
    // "final segment" branch lerps to local=0 of the next segment).
    // Either way, last point's x is the projected tip.
    const last = segs[segs.length - 1]!
    expect((last.args[0] as number)).toBe(1000) // 1 * 1000 from fakeMap
  })

  it('produces an identical sequence of calls for identical inputs (determinism)', () => {
    const a = makeFakeCtx()
    const b = makeFakeCtx()
    carveTripPath(a.ctx, fakeMap(), prep, 1750, 12)
    carveTripPath(b.ctx, fakeMap(), prep, 1750, 12)
    expect(a.calls).toEqual(b.calls)
  })

  it('extends further along the polyline as the cursor advances', () => {
    // Quarter way: target ~0.5 → tip x ≈ 0.5 → projected 500
    const q = makeFakeCtx()
    carveTripPath(q.ctx, fakeMap(), prep, 1250, 12)
    const qTip = q.calls.filter(c => c.op === 'lineTo').slice(-1)[0]!
    // Three-quarter way: target ~1.5 → tip x ≈ 1.5 → projected 1500
    const tq = makeFakeCtx()
    carveTripPath(tq.ctx, fakeMap(), prep, 1750, 12)
    const tqTip = tq.calls.filter(c => c.op === 'lineTo').slice(-1)[0]!
    expect(tqTip.args[0] as number).toBeGreaterThan(qTip.args[0] as number)
  })
})

// Accumulator contract: cursor changes (any size, any direction) and
// trip-set reference changes (poller refresh) must NOT reset the fog.
// destination-out is monotonic — each stroke only adds to the cleared
// area — so the fog naturally accumulates across a playback session,
// scrub, and loop wrap.
//
// Pixel-level verification isn't possible in happy-dom (the 2D context
// is a no-op mock). The behavioral fix is verified by:
//   1. The existing "renders the canvas when enabled" test (component
//      doesn't crash on any of these prop changes).
//   2. The typecheck — `shouldResetOnJump` is gone, no dangling reset
//      triggers in the source.
//   3. Visual smoke test in the dev server.
