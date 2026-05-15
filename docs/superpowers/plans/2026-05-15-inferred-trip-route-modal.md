# Inferred-trip route modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user click any inferred trip and see a modal with a map showing the trip's endpoints and Google's typical bike route between them.

**Architecture:** Routes are precached on R2 as a sibling artifact to the existing travel-time matrix. The modal is a pure client-side consumer — no fetch at click time. A new `compute-routes.ts` script and `routes.yml` workflow mirror the existing matrix patterns.

**Tech Stack:** React 18 + TypeScript + Vite, MapLibre GL JS v4, Tailwind, Vitest + @testing-library/react, Cloudflare R2, Google Directions API.

**Spec:** `docs/superpowers/specs/2026-05-15-inferred-trip-route-modal-design.md`

---

## File structure

| Path | Role | Responsibility |
|---|---|---|
| `src/shared/polyline.ts` | new | Pure polyline decoder (Google encoded → `[lng, lat][]`) |
| `src/shared/route-cache.ts` | new | `RouteCache` / `RouteEdge` types + `lookupRoute` helper |
| `src/web/hooks/useRouteCache.ts` | new | Fetches `gbfs/{systemId}/routes.json` from R2, mirrors `useTravelMatrix` |
| `src/web/lib/pin-svg.ts` | extend | Add `buildEndpointPin(role)` for origin/destination/via markers |
| `src/web/components/TripRouteModal.tsx` | new | The modal: frame, MapLibre lifecycle, pins, polyline, fallback, stats |
| `src/web/components/ActivityLog.tsx` | modify | Add `onTripClick` prop; wrap trip rows in `<button>`; stop-propagate link clicks |
| `src/web/routes/Activity.tsx` | modify | Hold `openTrip` state; render `<TripRouteModal>` |
| `src/web/routes/Explore.tsx` | modify | Same pattern |
| `src/web/routes/StationDetails.tsx` | modify | Same pattern |
| `scripts/compute-routes.ts` | new | Build script — Google Directions, change-detection, R2 write |
| `package.json` | modify | Add `compute-routes` npm script |
| `.github/workflows/routes.yml` | new | Daily check, manual dispatch, opens issue on station change |

Tests live next to their module (`*.test.ts(x)`), per the project's existing pattern.

`scripts/compute-routes.ts` imports `haversineMeters`, `diffStations`, `pairsToRecompute`, `allPairs`, `chunk`, and the R2 / station-fetch helpers from `scripts/compute-travel-times.ts` (its `main()` is already gated by an `import.meta.url` guard, so importing is side-effect-free).

---

## Task 1: Feature branch

**Files:** none.

- [ ] **Step 1: Confirm clean working tree on `main`**

Run: `git status && git branch --show-current`
Expected: working tree clean, branch is `main`.

- [ ] **Step 2: Create and switch to the feature branch**

Run: `git checkout -b feature/inferred-trip-route-modal`
Expected: `Switched to a new branch 'feature/inferred-trip-route-modal'`.

---

## Task 2: Polyline decoder

**Files:**
- Create: `src/shared/polyline.ts`
- Create: `src/shared/polyline.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/polyline.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { decodePolyline } from './polyline'

describe('decodePolyline', () => {
  it('decodes the canonical Google fixture into [lng, lat] pairs', () => {
    // From https://developers.google.com/maps/documentation/utilities/polylinealgorithm
    const points = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')
    expect(points).toHaveLength(3)
    expect(points[0]![0]).toBeCloseTo(-120.2, 5)
    expect(points[0]![1]).toBeCloseTo(38.5, 5)
    expect(points[1]![0]).toBeCloseTo(-120.95, 5)
    expect(points[1]![1]).toBeCloseTo(40.7, 5)
    expect(points[2]![0]).toBeCloseTo(-126.453, 5)
    expect(points[2]![1]).toBeCloseTo(43.252, 5)
  })

  it('returns an empty array for an empty input', () => {
    expect(decodePolyline('')).toEqual([])
  })

  it('decodes a single coordinate', () => {
    // Encoded form of (0, 0) is "??"
    expect(decodePolyline('??')).toEqual([[0, 0]])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/polyline.test.ts`
Expected: FAIL — module `./polyline` does not exist.

- [ ] **Step 3: Write the decoder**

Create `src/shared/polyline.ts`:

```ts
/**
 * Decode a Google-encoded polyline into [lng, lat] coordinate pairs.
 * Output order is [lng, lat] so the result drops straight into a GeoJSON LineString.
 * Algorithm: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
export function decodePolyline(encoded: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let index = 0
  let lat = 0
  let lng = 0

  while (index < encoded.length) {
    let result = 0
    let shift = 0
    let byte = 0
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    const dLat = (result & 1) ? ~(result >> 1) : (result >> 1)
    lat += dLat

    result = 0
    shift = 0
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    const dLng = (result & 1) ? ~(result >> 1) : (result >> 1)
    lng += dLng

    out.push([lng / 1e5, lat / 1e5])
  }

  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/polyline.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/polyline.ts src/shared/polyline.test.ts
git commit -m "feat(shared): polyline decoder for Google-encoded routes"
```

---

## Task 3: RouteCache types + lookupRoute

**Files:**
- Create: `src/shared/route-cache.ts`
- Create: `src/shared/route-cache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/route-cache.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { lookupRoute, type RouteCache, type RouteEdge } from './route-cache'

const EDGE_A_B: RouteEdge = { polyline: 'abc', meters: 1400, seconds: 420, via_station_ids: ['s3'] }

const CACHE: RouteCache = {
  computedAt: 1_700_000_000,
  stations: [
    { id: 's1', lat: 34.42, lon: -119.7 },
    { id: 's2', lat: 34.43, lon: -119.68 },
  ],
  edges: { s1: { s2: EDGE_A_B } },
}

describe('lookupRoute', () => {
  it('returns the edge when it exists', () => {
    expect(lookupRoute(CACHE, 's1', 's2')).toBe(EDGE_A_B)
  })

  it('returns null when the reverse edge is missing', () => {
    expect(lookupRoute(CACHE, 's2', 's1')).toBeNull()
  })

  it('returns null when either id is unknown', () => {
    expect(lookupRoute(CACHE, 's1', 'sX')).toBeNull()
    expect(lookupRoute(CACHE, 'sX', 's2')).toBeNull()
  })

  it('returns null when the cache itself is null or ids missing', () => {
    expect(lookupRoute(null, 's1', 's2')).toBeNull()
    expect(lookupRoute(CACHE, null, 's2')).toBeNull()
    expect(lookupRoute(CACHE, 's1', undefined)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/route-cache.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the types + helper**

Create `src/shared/route-cache.ts`:

```ts
export type RouteCacheStation = { id: string; lat: number; lon: number }

export type RouteEdge = {
  /** Google-encoded overview_polyline from the Directions response */
  polyline: string
  /** Distance from the Directions response, in meters */
  meters: number
  /** Duration from the Directions response (bike profile), in seconds */
  seconds: number
  /** IDs of stations within 150m of any polyline vertex, sorted by closest-vertex distance ascending */
  via_station_ids: string[]
}

export type RouteCache = {
  computedAt: number
  stations: RouteCacheStation[]
  edges: Record<string, Record<string, RouteEdge>>
}

export function lookupRoute(
  cache: RouteCache | null,
  fromId: string | null | undefined,
  toId: string | null | undefined,
): RouteEdge | null {
  if (!cache || !fromId || !toId) return null
  return cache.edges[fromId]?.[toId] ?? null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/route-cache.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/route-cache.ts src/shared/route-cache.test.ts
git commit -m "feat(shared): RouteCache types + lookupRoute helper"
```

---

## Task 4: useRouteCache hook

**Files:**
- Create: `src/web/hooks/useRouteCache.ts`

(No test — mirrors `useTravelMatrix`, which is also untested at the hook level. Failures surface through component tests later.)

- [ ] **Step 1: Write the hook**

Create `src/web/hooks/useRouteCache.ts`:

```ts
import { useEffect, useState } from 'react'
import type { RouteCache } from '@shared/route-cache'

export type RouteCacheState = {
  data: RouteCache | null
  loading: boolean
  error: Error | null
}

export function useRouteCache(r2Base: string, systemId: string): RouteCacheState {
  const [data, setData] = useState<RouteCache | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    const url = `${r2Base}/gbfs/${systemId}/routes.json`
    setLoading(true)
    setError(null)
    fetch(url)
      .then(async r => {
        if (!r.ok) throw new Error(`routes fetch failed: ${r.status}`)
        return r.json() as Promise<RouteCache>
      })
      .then(json => {
        if (cancelled) return
        setData(json)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e : new Error(String(e)))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [r2Base, systemId])

  return { data, loading, error }
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/web/hooks/useRouteCache.ts
git commit -m "feat(web): useRouteCache hook (R2 fetch, mirrors useTravelMatrix)"
```

---

## Task 5: Endpoint pin SVG helper

**Files:**
- Modify: `src/web/lib/pin-svg.ts` (append a new exported function)
- Modify: `src/web/lib/pin-svg.test.ts` (append a new describe block)

- [ ] **Step 1: Write the failing test**

Append to `src/web/lib/pin-svg.test.ts` (read first to find the appropriate spot — bottom of the existing `describe` block, or a sibling `describe`):

```ts
import { buildEndpointPin } from './pin-svg'

describe('buildEndpointPin', () => {
  it('renders an origin pin with the emerald fill', () => {
    const svg = buildEndpointPin('origin')
    expect(svg).toContain('<svg')
    expect(svg.toLowerCase()).toContain('#10b981') // emerald-500
  })

  it('renders a destination pin with a red fill', () => {
    const svg = buildEndpointPin('destination')
    expect(svg).toContain('<svg')
    expect(svg.toLowerCase()).toContain('#dc2626') // red-600
  })

  it('renders a via pin with reduced opacity', () => {
    const svg = buildEndpointPin('via')
    expect(svg).toContain('opacity="0.35"')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/web/lib/pin-svg.test.ts`
Expected: FAIL — `buildEndpointPin` is not exported.

- [ ] **Step 3: Add the helper**

Append to `src/web/lib/pin-svg.ts`:

```ts
export type EndpointRole = 'origin' | 'destination' | 'via'

const ENDPOINT_COLORS: Record<EndpointRole, { fill: string; stroke: string }> = {
  origin: { fill: '#10b981', stroke: '#047857' },       // emerald
  destination: { fill: '#dc2626', stroke: '#991b1b' },  // red
  via: { fill: '#9ca3af', stroke: '#6b7280' },          // neutral-400
}

/**
 * A simpler endpoint pin for the trip-route modal — no bike/dock numbers.
 * Reuses the teardrop outline. Via pins are smaller and dimmer.
 */
export function buildEndpointPin(role: EndpointRole): string {
  const { fill, stroke } = ENDPOINT_COLORS[role]
  const opacity = role === 'via' ? 0.35 : 1
  return `<svg viewBox="0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}" xmlns="http://www.w3.org/2000/svg" opacity="${opacity}">` +
    `<path d="${PIN_OUTLINE}" fill="${fill}" stroke="${stroke}" stroke-width="1"/>` +
    `<circle cx="${CX}" cy="15" r="4" fill="white"/>` +
    `</svg>`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/web/lib/pin-svg.test.ts`
Expected: PASS, all tests including the new 3.

- [ ] **Step 5: Commit**

```bash
git add src/web/lib/pin-svg.ts src/web/lib/pin-svg.test.ts
git commit -m "feat(web): endpoint pin SVG helper for trip-route modal"
```

---

## Task 6: TripRouteModal component

**Files:**
- Create: `src/web/components/TripRouteModal.tsx`
- Create: `src/web/components/TripRouteModal.test.tsx`

The component renders even when MapLibre fails to load (tests mock it). The map is created in a `useEffect` after mount; rendering doesn't depend on map readiness.

- [ ] **Step 1: Write the failing test**

Create `src/web/components/TripRouteModal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TripRouteModal from './TripRouteModal'
import type { Trip, StationSnapshot } from '@shared/types'
import type { TravelMatrix } from '../hooks/useTravelMatrix'
import type { RouteCache } from '@shared/route-cache'

// Module-level MapLibre mock so the modal never tries to render a real WebGL canvas
vi.mock('maplibre-gl', () => {
  const Map = vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    off: vi.fn(),
    remove: vi.fn(),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    getSource: vi.fn(() => null),
    fitBounds: vi.fn(),
    setStyle: vi.fn(),
  }))
  const Marker = vi.fn().mockImplementation(() => ({
    setLngLat: vi.fn().mockReturnThis(),
    addTo: vi.fn().mockReturnThis(),
    remove: vi.fn(),
  }))
  return { default: { Map, Marker, LngLatBounds: vi.fn() }, Map, Marker, LngLatBounds: vi.fn() }
})

const TRIP: Trip = {
  departure_ts: 1_700_000_000,
  arrival_ts: 1_700_000_540,
  from_station_id: 's1',
  to_station_id: 's2',
  duration_sec: 540,
}

const STATIONS: StationSnapshot[] = [
  { station_id: 's1', name: 'Origin Station', lat: 34.42, lon: -119.7, address: '', num_bikes_available: 1, num_docks_available: 1, bikes_electric: 0, bikes_classic: 1, bikes_smart: 0, is_installed: true, is_renting: true, is_returning: true, last_reported: 0 },
  { station_id: 's2', name: 'Destination Station', lat: 34.43, lon: -119.68, address: '', num_bikes_available: 1, num_docks_available: 1, bikes_electric: 0, bikes_classic: 1, bikes_smart: 0, is_installed: true, is_renting: true, is_returning: true, last_reported: 0 },
]

const MATRIX: TravelMatrix = {
  computedAt: 1_700_000_000,
  stations: [{ id: 's1', lat: 34.42, lon: -119.7 }, { id: 's2', lat: 34.43, lon: -119.68 }],
  edges: { s1: { s2: { minutes: 7, meters: 1400 } } },
}

const ROUTES: RouteCache = {
  computedAt: 1_700_000_000,
  stations: [{ id: 's1', lat: 34.42, lon: -119.7 }, { id: 's2', lat: 34.43, lon: -119.68 }],
  edges: { s1: { s2: { polyline: '??', meters: 1400, seconds: 420, via_station_ids: [] } } },
}

function renderModal(overrides: Partial<React.ComponentProps<typeof TripRouteModal>> = {}) {
  const onClose = vi.fn()
  const utils = render(
    <MemoryRouter>
      <TripRouteModal
        trip={TRIP}
        stations={STATIONS}
        matrix={MATRIX}
        routes={ROUTES}
        systemTz="America/Los_Angeles"
        onClose={onClose}
        {...overrides}
      />
    </MemoryRouter>
  )
  return { ...utils, onClose }
}

describe('TripRouteModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the origin and destination station names in the header', () => {
    renderModal()
    expect(screen.getByText('Origin Station')).toBeInTheDocument()
    expect(screen.getByText('Destination Station')).toBeInTheDocument()
  })

  it('renders actual, typical, and distance stats', () => {
    renderModal()
    expect(screen.getByText(/9 min/)).toBeInTheDocument()    // actual = 540s
    expect(screen.getByText(/7 min/)).toBeInTheDocument()    // typical
    expect(screen.getByText(/1\.4 km|1\.4\s*km/)).toBeInTheDocument()
  })

  it('renders the approximate-route note when the route is missing', () => {
    const emptyRoutes: RouteCache = { ...ROUTES, edges: {} }
    renderModal({ routes: emptyRoutes })
    expect(screen.getByText(/approximate route/i)).toBeInTheDocument()
  })

  it('does not render the approximate-route note when the route is present', () => {
    renderModal()
    expect(screen.queryByText(/approximate route/i)).not.toBeInTheDocument()
  })

  it('closes on Escape', () => {
    const { onClose } = renderModal()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes when the backdrop is clicked', () => {
    const { onClose } = renderModal()
    fireEvent.click(screen.getByTestId('trip-route-modal-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close when the dialog body is clicked', () => {
    const { onClose } = renderModal()
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/web/components/TripRouteModal.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Write the component**

Create `src/web/components/TripRouteModal.tsx`:

```tsx
import { useEffect, useMemo, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import type { Trip, StationSnapshot } from '@shared/types'
import { lookupRoute, type RouteCache } from '@shared/route-cache'
import { decodePolyline } from '@shared/polyline'
import { lookupTravelTime, type TravelMatrix } from '../hooks/useTravelMatrix'
import { buildEndpointPin } from '../lib/pin-svg'

const POSITRON_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
const VIA_DISTANCE_M = 150

type TripRouteModalProps = {
  trip: Trip
  stations: StationSnapshot[]
  matrix: TravelMatrix | null
  routes: RouteCache | null
  systemTz: string
  onClose: () => void
}

function formatClockTime(tsSec: number, tz: string): string {
  return new Date(tsSec * 1000).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz,
  })
}

function formatDateLine(tsSec: number, tz: string): string {
  return new Date(tsSec * 1000).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: tz,
  })
}

function formatMinutes(seconds: number): string {
  const m = Math.round(seconds / 60)
  return `${m} min`
}

function formatDistance(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`
}

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function makePinElement(role: 'origin' | 'destination' | 'via'): HTMLDivElement {
  const wrapper = document.createElement('div')
  wrapper.style.width = role === 'via' ? '20px' : '32px'
  wrapper.style.height = role === 'via' ? '27px' : '42px'
  wrapper.style.backgroundImage = `url("${svgDataUri(buildEndpointPin(role))}")`
  wrapper.style.backgroundSize = 'contain'
  wrapper.style.backgroundRepeat = 'no-repeat'
  wrapper.style.pointerEvents = 'none'
  return wrapper
}

export default function TripRouteModal({ trip, stations, matrix, routes, systemTz, onClose }: TripRouteModalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)

  const stationById = useMemo(() => new Map(stations.map(s => [s.station_id, s])), [stations])
  const fromStation = stationById.get(trip.from_station_id)
  const toStation = stationById.get(trip.to_station_id)
  const routeEdge = lookupRoute(routes, trip.from_station_id, trip.to_station_id)
  const matrixEdge = lookupTravelTime(matrix, trip.from_station_id, trip.to_station_id)

  // Lock body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Mount the map after the container exists; tear it down on unmount
  useEffect(() => {
    if (!containerRef.current || !fromStation || !toStation) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: POSITRON_STYLE,
      attributionControl: { compact: true },
      interactive: true,
    })
    mapRef.current = map

    const onLoad = () => {
      const decoded = routeEdge ? decodePolyline(routeEdge.polyline) : null
      const lineCoords: Array<[number, number]> = decoded && decoded.length >= 2
        ? decoded
        : [[fromStation.lon, fromStation.lat], [toStation.lon, toStation.lat]]

      map.addSource('trip-route', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: lineCoords } },
      })
      map.addLayer({
        id: 'trip-route-line',
        type: 'line',
        source: 'trip-route',
        paint: {
          'line-color': '#0d6cb0',
          'line-width': 4,
          'line-opacity': 0.85,
          ...(decoded ? {} : { 'line-dasharray': [2, 2] }),
        },
      })

      // Endpoint markers
      new maplibregl.Marker({ element: makePinElement('origin'), anchor: 'bottom' })
        .setLngLat([fromStation.lon, fromStation.lat])
        .addTo(map)
      new maplibregl.Marker({ element: makePinElement('destination'), anchor: 'bottom' })
        .setLngLat([toStation.lon, toStation.lat])
        .addTo(map)

      // Dim via-station markers
      if (routeEdge) {
        for (const viaId of routeEdge.via_station_ids) {
          if (viaId === trip.from_station_id || viaId === trip.to_station_id) continue
          const via = stationById.get(viaId)
          if (!via) continue
          new maplibregl.Marker({ element: makePinElement('via'), anchor: 'bottom' })
            .setLngLat([via.lon, via.lat])
            .addTo(map)
        }
      }

      // Fit bounds
      const bounds = new maplibregl.LngLatBounds()
      for (const c of lineCoords) bounds.extend(c)
      map.fitBounds(bounds, { padding: 40, duration: 0 })
    }

    map.on('load', onLoad)

    return () => {
      map.off('load', onLoad)
      map.remove()
      mapRef.current = null
    }
  }, [fromStation, toStation, routeEdge, stationById, trip.from_station_id, trip.to_station_id])

  if (!fromStation || !toStation) {
    // Defensive: parent should not render the modal until stations are loaded.
    return null
  }

  const actualSec = trip.duration_sec
  const typicalSec = matrixEdge ? matrixEdge.minutes * 60 : null
  const distanceMeters = routeEdge?.meters ?? matrixEdge?.meters ?? null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-900/60 backdrop-blur-sm"
      data-testid="trip-route-modal-backdrop"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="trip-route-modal-title"
        className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-4 border-b border-neutral-200">
          <div>
            <h2 id="trip-route-modal-title" className="text-base font-semibold text-neutral-900">
              <span>{fromStation.name}</span>
              <span className="text-neutral-400 mx-1">→</span>
              <span>{toStation.name}</span>
            </h2>
            <p className="text-xs text-neutral-500 mt-1">
              {formatClockTime(trip.departure_ts, systemTz)} → {formatClockTime(trip.arrival_ts, systemTz)}
              <span className="mx-1">·</span>
              {formatDateLine(trip.departure_ts, systemTz)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-neutral-500 hover:text-neutral-900 text-xl leading-none p-1"
          >
            ✕
          </button>
        </div>

        <div
          ref={containerRef}
          className="h-72 sm:h-96 w-full bg-neutral-100"
          aria-label="Bike route map"
        />

        <div className="p-4 border-t border-neutral-200">
          <dl className="grid grid-cols-3 gap-3 text-center">
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-neutral-500">Actual</dt>
              <dd className="text-sm font-semibold text-neutral-900">{formatMinutes(actualSec)}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-neutral-500">Typical</dt>
              <dd className="text-sm font-semibold text-neutral-900">
                {typicalSec !== null ? formatMinutes(typicalSec) : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-neutral-500">Distance</dt>
              <dd className="text-sm font-semibold text-neutral-900">
                {distanceMeters !== null ? formatDistance(distanceMeters) : '—'}
              </dd>
            </div>
          </dl>
          {!routeEdge && (
            <p className="text-[11px] text-neutral-500 mt-3 text-center">
              Approximate route — bike directions not yet cached for this pair.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/web/components/TripRouteModal.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/web/components/TripRouteModal.tsx src/web/components/TripRouteModal.test.tsx
git commit -m "feat(web): TripRouteModal — map + endpoints + typical route polyline"
```

---

## Task 7: ActivityLog onTripClick prop

**Files:**
- Modify: `src/web/components/ActivityLog.tsx`
- Modify: `src/web/components/ActivityLog.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/web/components/ActivityLog.test.tsx` inside the existing `describe('ActivityLog', ...)` block, after the last `it(...)`:

```tsx
import { fireEvent } from '@testing-library/react'

it('fires onTripClick with the trip when a trip row is clicked', () => {
  const trip = { departure_ts: 1_700_000_000, arrival_ts: 1_700_000_540, from_station_id: 'anacapa', to_station_id: 'bath', duration_sec: 540 }
  const log: ActivityLogData = {
    events: [],
    trips: [trip],
    inFlightFromStationId: null,
    inFlightDepartureTs: null,
  }
  const onTripClick = vi.fn()
  renderWithRouter(<ActivityLog log={log} stations={STATIONS} matrix={MATRIX} onTripClick={onTripClick} />)
  fireEvent.click(screen.getByRole('button', { name: /anacapa.*bath/i }))
  expect(onTripClick).toHaveBeenCalledWith(trip)
})

it('does not fire onTripClick when a station-name link inside a trip row is clicked', () => {
  const trip = { departure_ts: 1_700_000_000, arrival_ts: 1_700_000_540, from_station_id: 'anacapa', to_station_id: 'bath', duration_sec: 540 }
  const log: ActivityLogData = {
    events: [],
    trips: [trip],
    inFlightFromStationId: null,
    inFlightDepartureTs: null,
  }
  const onTripClick = vi.fn()
  renderWithRouter(<ActivityLog log={log} stations={STATIONS} matrix={MATRIX} onTripClick={onTripClick} />)
  // The link text is the from-station name
  const link = screen.getAllByRole('link').find(a => /anacapa/i.test(a.textContent ?? '')) as HTMLElement
  fireEvent.click(link)
  expect(onTripClick).not.toHaveBeenCalled()
})
```

You will also need to add `vi` to the existing imports if not already imported:
```ts
import { describe, it, expect, vi } from 'vitest'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/web/components/ActivityLog.test.tsx`
Expected: FAIL — `onTripClick` prop not supported; row is not a button.

- [ ] **Step 3: Add the prop and rework the trip `<li>`**

Edit `src/web/components/ActivityLog.tsx`:

3a. Add the prop to the `Props` type and destructure it (default to `undefined`):

```ts
type Props = {
  log: ActivityLogData | null
  stations: StationSnapshot[]
  matrix: TravelMatrix | null
  timezone?: string
  maxEvents?: number
  maxTrips?: number
  stationFilter?: string
  unbounded?: boolean
  /** Fires when a trip row is clicked. The station-name links inside the row do not trigger this. */
  onTripClick?: (trip: Trip) => void
}
```

```ts
export default function ActivityLog({ log, stations, matrix, timezone, maxEvents = 20, maxTrips = 20, stationFilter, unbounded = false, onTripClick }: Props) {
```

3b. Replace the trip `<li>` block. Find this in the existing file:

```tsx
return (
  <li key={`${trip.departure_ts}-${trip.arrival_ts}`} className="text-xs border border-neutral-200 rounded p-2 bg-neutral-50">
    <div className="flex items-baseline justify-between gap-2">
      <span className="font-medium text-neutral-700 truncate">
        <Link to={`/station/${trip.from_station_id}/details`} className="hover:text-sky-700 hover:underline">{fromName}</Link>
        <span className="text-neutral-400"> → </span>
        <Link to={`/station/${trip.to_station_id}/details`} className="hover:text-sky-700 hover:underline">{toName}</Link>
      </span>
      <span className="text-neutral-400 whitespace-nowrap">{formatClockTime(trip.departure_ts, timezone)}</span>
    </div>
    <div className="mt-0.5 text-neutral-500">
      <span className="font-medium text-neutral-700">{tripDurationLabel(trip)}</span>
      {expected && (
        <>
          <span> · expected {expected.minutes} min</span>
          {diff !== null && diff !== 0 && (
            <span className={diff > 0 ? 'text-orange-600' : 'text-emerald-700'}>
              {' '}({diff > 0 ? '+' : ''}{diff})
            </span>
          )}
        </>
      )}
    </div>
  </li>
)
```

Replace with:

```tsx
const rowLabel = `${fromName} → ${toName}`
return (
  <li key={`${trip.departure_ts}-${trip.arrival_ts}`}>
    <button
      type="button"
      onClick={() => onTripClick?.(trip)}
      aria-label={rowLabel}
      className="w-full text-left text-xs border border-neutral-200 rounded p-2 bg-neutral-50 hover:bg-white hover:border-neutral-300 focus:outline-none focus:ring-2 focus:ring-sky-300 transition-colors"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-neutral-700 truncate">
          <Link to={`/station/${trip.from_station_id}/details`} onClick={e => e.stopPropagation()} className="hover:text-sky-700 hover:underline">{fromName}</Link>
          <span className="text-neutral-400"> → </span>
          <Link to={`/station/${trip.to_station_id}/details`} onClick={e => e.stopPropagation()} className="hover:text-sky-700 hover:underline">{toName}</Link>
        </span>
        <span className="text-neutral-400 whitespace-nowrap">{formatClockTime(trip.departure_ts, timezone)}</span>
      </div>
      <div className="mt-0.5 text-neutral-500">
        <span className="font-medium text-neutral-700">{tripDurationLabel(trip)}</span>
        {expected && (
          <>
            <span> · expected {expected.minutes} min</span>
            {diff !== null && diff !== 0 && (
              <span className={diff > 0 ? 'text-orange-600' : 'text-emerald-700'}>
                {' '}({diff > 0 ? '+' : ''}{diff})
              </span>
            )}
          </>
        )}
      </div>
    </button>
  </li>
)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/web/components/ActivityLog.test.tsx`
Expected: PASS, all tests including the 2 new ones.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/web/components/ActivityLog.tsx src/web/components/ActivityLog.test.tsx
git commit -m "feat(web): ActivityLog trip rows fire onTripClick"
```

---

## Task 8: Wire TripRouteModal into Activity, Explore, StationDetails

**Files:**
- Modify: `src/web/routes/Activity.tsx`
- Modify: `src/web/routes/Explore.tsx`
- Modify: `src/web/routes/StationDetails.tsx`

The pattern is the same in each page:
1. Add `useRouteCache` next to `useTravelMatrix`.
2. Hold `const [openTrip, setOpenTrip] = useState<Trip | null>(null)`.
3. Pass `onTripClick={setOpenTrip}` into `<ActivityLog>`.
4. Render `<TripRouteModal ... />` when `openTrip` is truthy.

- [ ] **Step 1: Wire `Activity.tsx`**

Edit `src/web/routes/Activity.tsx`. Imports at the top:

```ts
import { useState } from 'react'
import { useRouteCache } from '../hooks/useRouteCache'
import TripRouteModal from '../components/TripRouteModal'
import type { Trip } from '@shared/types'
```

Inside the component, after the existing hook calls:

```ts
const routes = useRouteCache(R2_BASE, SYSTEM_ID)
const [openTrip, setOpenTrip] = useState<Trip | null>(null)
```

Update the `<ActivityLog>` call to pass `onTripClick={setOpenTrip}`:

```tsx
<ActivityLog
  log={activity.data}
  stations={live?.stations ?? []}
  matrix={matrix.data}
  timezone={live?.system.timezone}
  maxEvents={200}
  maxTrips={50}
  unbounded
  onTripClick={setOpenTrip}
/>
```

Append below the `<section>`:

```tsx
{openTrip && (
  <TripRouteModal
    trip={openTrip}
    stations={live?.stations ?? []}
    matrix={matrix.data}
    routes={routes.data}
    systemTz={live?.system.timezone ?? 'UTC'}
    onClose={() => setOpenTrip(null)}
  />
)}
```

- [ ] **Step 2: Wire `Explore.tsx`**

Edit `src/web/routes/Explore.tsx`.

2a. Add the new imports near the existing imports at the top of the file:

```ts
import { useRouteCache } from '../hooks/useRouteCache'
import TripRouteModal from '../components/TripRouteModal'
import type { Trip } from '@shared/types'
```

(`useState` is already imported on line 1; you don't need to re-import it.)

2b. Inside the `Explore` component function (around the existing `const matrix = useTravelMatrix(R2_BASE, SYSTEM_ID)` line, ~line 28), add two new lines right below it:

```ts
const routes = useRouteCache(R2_BASE, SYSTEM_ID)
const [openTrip, setOpenTrip] = useState<Trip | null>(null)
```

2c. Find the `<ActivityLog>` JSX call (around line 93). Add an `onTripClick={setOpenTrip}` prop to its prop list, matching the indentation of the existing props.

2d. Just before the component's closing `</...>` wrapping element (the outermost element returned), insert the modal mount:

```tsx
{openTrip && (
  <TripRouteModal
    trip={openTrip}
    stations={live?.stations ?? []}
    matrix={matrix.data}
    routes={routes.data}
    systemTz={live?.system.timezone ?? 'UTC'}
    onClose={() => setOpenTrip(null)}
  />
)}
```

- [ ] **Step 3: Wire `StationDetails.tsx`**

Edit `src/web/routes/StationDetails.tsx`.

3a. Add the new imports at the top of the file alongside the existing imports:

```ts
import { useRouteCache } from '../hooks/useRouteCache'
import TripRouteModal from '../components/TripRouteModal'
import type { Trip } from '@shared/types'
```

(`useState` is already imported on line 1.)

3b. Inside the `StationDetails` component (around line 247 near the existing `const matrix = useTravelMatrix(R2_BASE, SYSTEM_ID)` line), add two new lines right below it:

```ts
const routes = useRouteCache(R2_BASE, SYSTEM_ID)
const [openTrip, setOpenTrip] = useState<Trip | null>(null)
```

3c. Find the `<ActivityLog>` JSX call (around line 474). Add an `onTripClick={setOpenTrip}` prop to its prop list, matching the indentation of the existing props.

3d. Just before the component's outermost closing element, insert the same modal mount as in Step 2d:

```tsx
{openTrip && (
  <TripRouteModal
    trip={openTrip}
    stations={live?.stations ?? []}
    matrix={matrix.data}
    routes={routes.data}
    systemTz={live?.system.timezone ?? 'UTC'}
    onClose={() => setOpenTrip(null)}
  />
)}
```

- [ ] **Step 4: Run all web tests**

Run: `npx vitest run src/web`
Expected: PASS, no regressions.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Build the web app**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/web/routes/Activity.tsx src/web/routes/Explore.tsx src/web/routes/StationDetails.tsx
git commit -m "feat(web): open TripRouteModal from Activity, Explore, StationDetails"
```

---

## Task 9: compute-routes build script

**Files:**
- Create: `scripts/compute-routes.ts`

Imports utilities from `scripts/compute-travel-times.ts` (its `main()` is gated by an `import.meta.url` guard).

- [ ] **Step 1: Write the script**

Create `scripts/compute-routes.ts`:

```ts
import { S3Client } from '@aws-sdk/client-s3'
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import {
  haversineMeters,
  diffStations,
  pairsToRecompute,
  allPairs,
  type Station,
} from './compute-travel-times'
import { decodePolyline } from '../src/shared/polyline'
import type { RouteCache, RouteEdge } from '../src/shared/route-cache'

const DIRECTIONS_INTER_CALL_DELAY_MS = 100
const VIA_DISTANCE_M = 150

type Env = {
  CF_ACCOUNT_ID?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
  R2_BUCKET?: string
  GOOGLE_MAPS_API_KEY?: string
  SYSTEM_ID?: string
  API_BASE?: string
  MODE?: string
}

function requireEnv(env: Env, key: keyof Env): string {
  const v = env[key]
  if (!v) throw new Error(`Missing env var: ${key}`)
  return v
}

async function r2GetRoutes(s3: S3Client, bucket: string, key: string): Promise<RouteCache | null> {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    const text = await r.Body!.transformToString()
    return JSON.parse(text) as RouteCache
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'name' in e && (e as { name: string }).name === 'NoSuchKey') return null
    throw e
  }
}

async function r2PutRoutes(s3: S3Client, bucket: string, key: string, body: string): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: 'application/json',
    CacheControl: 'public, max-age=300',
  }))
}

async function fetchCurrentStations(apiBase: string, systemId: string): Promise<Station[]> {
  const r = await fetch(`${apiBase}/api/systems/${systemId}/current`)
  if (!r.ok) throw new Error(`fetchCurrentStations failed: ${r.status}`)
  const json = await r.json() as { stations: Array<{ station_id: string; lat: number; lon: number }> }
  return json.stations.map(s => ({ id: s.station_id, lat: s.lat, lon: s.lon }))
}

async function fetchDirectionsRoute(from: Station, to: Station, apiKey: string): Promise<RouteEdge | null> {
  const url = new URL('https://maps.googleapis.com/maps/api/directions/json')
  url.searchParams.set('origin', `${from.lat},${from.lon}`)
  url.searchParams.set('destination', `${to.lat},${to.lon}`)
  url.searchParams.set('mode', 'bicycling')
  url.searchParams.set('units', 'metric')
  url.searchParams.set('key', apiKey)
  const r = await fetch(url.toString())
  if (!r.ok) throw new Error(`Directions API HTTP ${r.status}`)
  const body = await r.json() as {
    status: string
    routes: Array<{
      overview_polyline: { points: string }
      legs: Array<{ distance: { value: number }; duration: { value: number } }>
    }>
  }
  if (body.status !== 'OK' || body.routes.length === 0) return null
  const route = body.routes[0]!
  const polyline = route.overview_polyline.points
  const meters = route.legs.reduce((s, l) => s + l.distance.value, 0)
  const seconds = route.legs.reduce((s, l) => s + l.duration.value, 0)
  return { polyline, meters, seconds, via_station_ids: [] }
}

function computeViaStations(polyline: string, fromId: string, toId: string, allStations: Station[]): string[] {
  const verts = decodePolyline(polyline)
  if (verts.length === 0) return []
  const matches: Array<{ id: string; minDist: number }> = []
  for (const s of allStations) {
    if (s.id === fromId || s.id === toId) continue
    let minDist = Infinity
    for (const [lng, lat] of verts) {
      const d = haversineMeters(s.lat, s.lon, lat, lng)
      if (d < minDist) minDist = d
      if (minDist <= VIA_DISTANCE_M) break // early exit; we only care about the min
    }
    if (minDist <= VIA_DISTANCE_M) matches.push({ id: s.id, minDist })
  }
  matches.sort((a, b) => a.minDist - b.minDist)
  return matches.map(m => m.id)
}

type RouteUpdate = { from: string; to: string; edge: RouteEdge }

async function computeRoutesSequential(
  pairs: Array<[Station, Station]>,
  apiKey: string,
  allStations: Station[],
): Promise<RouteUpdate[]> {
  const updates: RouteUpdate[] = []
  let i = 0
  for (const [from, to] of pairs) {
    i++
    try {
      const edge = await fetchDirectionsRoute(from, to, apiKey)
      if (edge) {
        edge.via_station_ids = computeViaStations(edge.polyline, from.id, to.id, allStations)
        updates.push({ from: from.id, to: to.id, edge })
      }
    } catch (e: unknown) {
      console.warn(`directions failed for ${from.id} -> ${to.id}:`, e instanceof Error ? e.message : e)
    }
    if (i % 50 === 0) console.log(`  progress: ${i}/${pairs.length}`)
    await new Promise(r => setTimeout(r, DIRECTIONS_INTER_CALL_DELAY_MS))
  }
  return updates
}

function mergeRouteEdges(
  existing: RouteCache['edges'],
  updates: RouteUpdate[],
  removedIds: Set<string>,
): RouteCache['edges'] {
  const out: RouteCache['edges'] = {}
  for (const fromId of Object.keys(existing)) {
    if (removedIds.has(fromId)) continue
    for (const toId of Object.keys(existing[fromId]!)) {
      if (removedIds.has(toId)) continue
      if (!out[fromId]) out[fromId] = {}
      out[fromId]![toId] = existing[fromId]![toId]!
    }
  }
  for (const u of updates) {
    if (!out[u.from]) out[u.from] = {}
    out[u.from]![u.to] = u.edge
  }
  return out
}

function buildRouteEdgesFromUpdates(updates: RouteUpdate[]): RouteCache['edges'] {
  const out: RouteCache['edges'] = {}
  for (const u of updates) {
    if (!out[u.from]) out[u.from] = {}
    out[u.from]![u.to] = u.edge
  }
  return out
}

if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const env = process.env as Env
    const mode = (env.MODE ?? 'check').trim()
    const systemId = requireEnv(env, 'SYSTEM_ID')
    const apiBase = requireEnv(env, 'API_BASE')
    const bucket = requireEnv(env, 'R2_BUCKET')
    const accountId = requireEnv(env, 'CF_ACCOUNT_ID')
    const accessKeyId = requireEnv(env, 'R2_ACCESS_KEY_ID')
    const secretAccessKey = requireEnv(env, 'R2_SECRET_ACCESS_KEY')

    const s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    })

    const key = `gbfs/${systemId}/routes.json`
    const existing = await r2GetRoutes(s3, bucket, key)
    const current = await fetchCurrentStations(apiBase, systemId)
    const prev: Station[] = existing?.stations ?? []
    const diff = diffStations(prev, current)
    const removedIds = new Set(diff.removed.map(s => s.id))

    const summary = {
      hasChanges: diff.added.length + diff.moved.length + diff.removed.length > 0,
      added: diff.added.map(s => s.id),
      moved: diff.moved.map(s => s.id),
      removed: diff.removed.map(s => s.id),
    }
    console.log(`CHECK_SUMMARY=${JSON.stringify(summary)}`)

    if (mode === 'check') {
      console.log(`check mode (mode=${mode}): no API calls made.`)
      return
    }

    if (!env.GOOGLE_MAPS_API_KEY) throw new Error('Missing env var: GOOGLE_MAPS_API_KEY (required for compute / compute-full)')
    const apiKey = env.GOOGLE_MAPS_API_KEY

    let updates: RouteUpdate[] = []
    if (mode === 'compute-full') {
      const pairs = allPairs(current)
      console.log(`compute-full: ${pairs.length} pairs`)
      updates = await computeRoutesSequential(pairs, apiKey, current)
    } else if (mode === 'compute') {
      const changedSet = new Set<string>([...diff.added.map(s => s.id), ...diff.moved.map(s => s.id)])
      if (changedSet.size === 0 && removedIds.size === 0) {
        console.log('No changes detected; routes unchanged.')
        return
      }
      if (changedSet.size > 0) {
        const pairs = pairsToRecompute(current, diff)
        console.log(`compute: ${pairs.length} pairs (changed × all + other × changed)`)
        updates = await computeRoutesSequential(pairs, apiKey, current)
      }
    } else {
      throw new Error(`unknown mode: ${mode}`)
    }

    const mergedEdges = mode === 'compute-full'
      ? buildRouteEdgesFromUpdates(updates)
      : mergeRouteEdges(existing?.edges ?? {}, updates, removedIds)

    const cache: RouteCache = {
      computedAt: Math.floor(Date.now() / 1000),
      stations: current.map(s => ({ id: s.id, lat: s.lat, lon: s.lon })),
      edges: mergedEdges,
    }
    await r2PutRoutes(s3, bucket, key, JSON.stringify(cache))
    const edgeCount = Object.keys(mergedEdges).reduce((s, k) => s + Object.keys(mergedEdges[k]!).length, 0)
    console.log(`Wrote ${edgeCount} route edges to ${key} (${updates.length} fresh, mode=${mode})`)
  })().catch(err => {
    console.error('compute-routes failed:', err)
    process.exit(1)
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Dry-run `check` mode locally**

This makes zero API calls but exercises the R2 read + station diff path. Requires the same env vars the workflow uses.

Run:
```bash
SYSTEM_ID=bcycle_santabarbara \
API_BASE=https://bcycle-map-read-api.developer-95b.workers.dev \
R2_BUCKET=$R2_BUCKET \
CF_ACCOUNT_ID=$CF_ACCOUNT_ID \
R2_ACCESS_KEY_ID=$R2_ACCESS_KEY_ID \
R2_SECRET_ACCESS_KEY=$R2_SECRET_ACCESS_KEY \
MODE=check \
npx tsx scripts/compute-routes.ts
```

Expected: prints `CHECK_SUMMARY={...}` and `check mode ... no API calls made.`

If you do not have the R2 secrets locally, skip this step and rely on the CI workflow_dispatch run in Task 11.

- [ ] **Step 4: Commit**

```bash
git add scripts/compute-routes.ts
git commit -m "feat(scripts): compute-routes — precache Google Directions polylines to R2"
```

---

## Task 10: package.json npm script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Read the existing scripts block**

Run: `grep -A 20 '"scripts"' /Users/samgutentag/Developer/bcycle-map/package.json | head -25`

You're looking for the `"compute-travel-times": "..."` line to mirror.

- [ ] **Step 2: Add `compute-routes`**

In the `"scripts"` block, alongside the existing `"compute-travel-times"` entry, add:

```json
"compute-routes": "tsx scripts/compute-routes.ts"
```

(Keep JSON valid — add a comma to the preceding line if needed.)

- [ ] **Step 3: Verify the script is wired**

Run: `npm run compute-routes -- --help 2>&1 | head -5 || true`

You should see either `check mode (mode=check)...` (if env vars are set) or a `Missing env var: ...` error. Either confirms the script is invokable.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore(scripts): npm run compute-routes"
```

---

## Task 11: routes.yml workflow

**Files:**
- Create: `.github/workflows/routes.yml`

Modeled directly on `.github/workflows/travel-times.yml`. Different cron offset (avoid running at the same minute as the matrix), different label, different issue title.

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/routes.yml`:

```yaml
name: routes

on:
  schedule:
    # Daily — `check` mode only, no Google API calls. Offset 15 minutes from travel-times.
    - cron: '30 14 * * *'
  workflow_dispatch:
    inputs:
      mode:
        description: 'Mode: check (free, diff only), compute (incremental Google calls), compute-full (full Google rebuild)'
        type: choice
        options:
          - check
          - compute
          - compute-full
        default: check

permissions:
  contents: read
  issues: write

env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: 'true'

concurrency:
  group: routes
  cancel-in-progress: false

jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci

      - name: Run routes script
        id: run
        run: |
          set -o pipefail
          npx tsx scripts/compute-routes.ts 2>&1 | tee run.log
          grep -oE 'CHECK_SUMMARY=\{.*\}' run.log | sed 's/^CHECK_SUMMARY=//' > check-summary.json || echo '{}' > check-summary.json
          echo "summary=$(cat check-summary.json | jq -c .)" >> $GITHUB_OUTPUT
        env:
          MODE: ${{ github.event.inputs.mode || 'check' }}
          CF_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          R2_BUCKET: ${{ secrets.R2_BUCKET }}
          GOOGLE_MAPS_API_KEY: ${{ secrets.GOOGLE_MAPS_API_KEY }}
          SYSTEM_ID: bcycle_santabarbara
          API_BASE: https://bcycle-map-read-api.developer-95b.workers.dev

      - name: File / update issue if changes detected (check mode only)
        if: github.event.inputs.mode == 'check' || github.event_name == 'schedule'
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          SUMMARY: ${{ steps.run.outputs.summary }}
        run: |
          HAS_CHANGES=$(echo "$SUMMARY" | jq -r '.hasChanges // false')
          if [ "$HAS_CHANGES" != "true" ]; then
            echo "No station changes detected."
            exit 0
          fi
          ADDED=$(echo "$SUMMARY" | jq -r '.added | join(", ")')
          MOVED=$(echo "$SUMMARY" | jq -r '.moved | join(", ")')
          REMOVED=$(echo "$SUMMARY" | jq -r '.removed | join(", ")')

          TITLE="Routes cache: station changes need a recompute"
          BODY=$(cat <<EOF
          The daily \`routes\` check detected station changes that affect the bike-route cache.

          - **Added**: $ADDED
          - **Moved**: $MOVED
          - **Removed**: $REMOVED

          To update the cache, manually run the \`routes\` workflow with \`mode: compute\` (incremental, only changed pairs) or \`mode: compute-full\` (full rebuild).

          Last detected: $(date -u +"%Y-%m-%d %H:%M UTC")
          EOF
          )

          EXISTING=$(gh issue list --label routes --state open --json number --jq '.[0].number' || true)
          if [ -n "$EXISTING" ]; then
            gh issue comment "$EXISTING" --body "$BODY"
          else
            gh issue create --title "$TITLE" --label routes --body "$BODY"
          fi
```

- [ ] **Step 2: Create the `routes` label so the workflow's `gh issue list --label routes` can find it**

Run: `gh label create routes --description "Routes cache rebuild needed" --color "0e8a16" --repo samgutentag/bcycle-map`
Expected: label created. If the label exists, the command errors — ignore.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/routes.yml
git commit -m "ci: routes workflow — daily check, manual compute, rolling issue"
```

---

## Task 12: Final verification + PR

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS, no regressions.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Dev server smoke test**

Run: `npm run dev` in one terminal. In a browser:

1. Open `/activity`. Click any inferred trip row. Modal opens. Map renders (basemap visible). If routes.json is not yet deployed, the modal shows a dashed line + "Approximate route" note. Stats render. Press Escape — modal closes. Open again, click backdrop — modal closes. Open again, click a station-name link inside the row — navigates to that station, modal does NOT open.
2. Open `/explore`. Repeat the trip-row click in the activity tile.
3. Open `/station/{any-id}/details`. Repeat.

- [ ] **Step 5: Push and open PR**

```bash
git push -u origin feature/inferred-trip-route-modal
gh pr create \
  --title "feat(web): inferred-trip route modal + precached bike-route cache" \
  --body "$(cat <<'EOF'
## Summary

- Click any inferred trip and see a modal with the trip's endpoints + Google's typical bike route between them.
- New R2 artifact `gbfs/{systemId}/routes.json` precaches the polylines; the modal reads it client-side, no Worker fetch at click time.
- New `compute-routes.ts` script + `.github/workflows/routes.yml` mirror the existing travel-times pattern (daily check, manual compute, rolling issue on station changes).
- Stations within 150m of the polyline render as dim "via" pins.
- Graceful fallback (dashed straight line + note) when a route is not yet cached for a given pair.

Spec: `docs/superpowers/specs/2026-05-15-inferred-trip-route-modal-design.md`

## Test plan

- [ ] Run `npx vitest run` — full suite passes
- [ ] Run `npx tsc --noEmit` — typecheck clean
- [ ] Run `npm run build` — bundle builds
- [ ] On `/activity`, `/explore`, and a `/station/:id/details` page: click an inferred trip, modal opens with map + endpoints
- [ ] Escape closes; backdrop click closes; station-name link inside the row does NOT close, it navigates
- [ ] Open a trip whose pair has no cached route — modal shows dashed line + "Approximate route" note
- [ ] Manually dispatch the `routes` workflow with `mode: check` — completes, no Google API calls, summary printed

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: After CI passes, dispatch the routes workflow manually**

```bash
gh workflow run routes --repo samgutentag/bcycle-map -f mode=check
```

Verify the run completes and `CHECK_SUMMARY=...` appears in the logs.

- [ ] **Step 7: If you want to populate routes.json now, dispatch a full rebuild**

This costs ~$45 of Google quota for 95 stations. Skip unless you want the modal to light up immediately on merge; otherwise the next CI-detected station-change run does it incrementally.

```bash
gh workflow run routes --repo samgutentag/bcycle-map -f mode=compute-full
```
