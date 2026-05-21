import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import TripRouteMap from './TripRouteMap'
import type { StationSnapshot } from '@shared/types'
import type { RouteEdge } from '@shared/route-cache'
import { UnitSystemProvider } from '../hooks/useUnitSystem'
import type { UnitSystem } from '../lib/units'

// Captured map state that tests can read between renders.
type MapCapture = {
  loadHandlers: Array<() => void>
  source: { setData: ReturnType<typeof vi.fn>; data: unknown } | null
  layer: Record<string, unknown> | null
}

const mapCaptures: MapCapture[] = []
const markerElements: HTMLElement[] = []
const popupInstances: Array<{
  text: string
  addTo: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
  isOpen: () => boolean
  _open: { value: boolean }
}> = []

vi.mock('maplibre-gl', () => {
  class FakeMap {
    private capture: MapCapture = { loadHandlers: [], source: null, layer: null }
    constructor() {
      mapCaptures.push(this.capture)
    }
    on(event: string, cb: () => void) {
      if (event === 'load') this.capture.loadHandlers.push(cb)
    }
    off() {}
    remove() {}
    addSource(_id: string, def: { type: string; data: unknown }) {
      this.capture.source = {
        data: def.data,
        setData: vi.fn().mockImplementation((next: unknown) => {
          if (this.capture.source) this.capture.source.data = next
        }),
      }
    }
    addLayer(def: Record<string, unknown>) {
      this.capture.layer = def
    }
    getSource(_id: string) {
      return this.capture.source
    }
    fitBounds() {}
  }

  class FakeMarker {
    private element: HTMLElement
    constructor(opts: { element: HTMLElement }) {
      this.element = opts.element
      markerElements.push(opts.element)
    }
    setLngLat() {
      return this
    }
    addTo() {
      // Attach the marker element to document.body so event handlers can fire
      // in tests via fireEvent / dispatchEvent.
      if (!this.element.isConnected) document.body.appendChild(this.element)
      return this
    }
    remove() {
      if (this.element.parentNode) this.element.parentNode.removeChild(this.element)
    }
  }

  class FakePopup {
    private _text = ''
    private _open = { value: false }
    private addToMock = vi.fn().mockImplementation(() => {
      this._open.value = true
      return this
    })
    private removeMock = vi.fn().mockImplementation(() => {
      this._open.value = false
      return this
    })
    constructor() {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this
      popupInstances.push({
        get text() {
          return self._text
        },
        addTo: this.addToMock,
        remove: this.removeMock,
        isOpen: () => this._open.value,
        _open: this._open,
      })
    }
    setText(t: string) {
      this._text = t
      return this
    }
    setLngLat() {
      return this
    }
    addTo() {
      return this.addToMock()
    }
    remove() {
      return this.removeMock()
    }
    isOpen() {
      return this._open.value
    }
  }

  class FakeLngLatBounds {
    extend() {}
  }

  return {
    default: { Map: FakeMap, Marker: FakeMarker, Popup: FakePopup, LngLatBounds: FakeLngLatBounds },
    Map: FakeMap,
    Marker: FakeMarker,
    Popup: FakePopup,
    LngLatBounds: FakeLngLatBounds,
  }
})

const FROM: StationSnapshot = {
  station_id: 's1', name: 'Origin', lat: 0, lon: 0, address: '',
  num_bikes_available: 1, num_docks_available: 1, bikes_electric: 0, bikes_classic: 1, bikes_smart: 0,
  is_installed: true, is_renting: true, is_returning: true, last_reported: 0,
}
const TO: StationSnapshot = {
  station_id: 's2', name: 'Destination', lat: 0, lon: 0.1, address: '',
  num_bikes_available: 1, num_docks_available: 1, bikes_electric: 0, bikes_classic: 1, bikes_smart: 0,
  is_installed: true, is_renting: true, is_returning: true, last_reported: 0,
}
const VIA: StationSnapshot = {
  station_id: 's-via', name: 'Via Station Name', lat: 0, lon: 0.05, address: '',
  num_bikes_available: 0, num_docks_available: 0, bikes_electric: 0, bikes_classic: 0, bikes_smart: 0,
  is_installed: true, is_renting: true, is_returning: true, last_reported: 0,
}

/** Encode a polyline of [[lat, lng], ...] pairs into a Google polyline string. */
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

function makeRouteEdge(): RouteEdge {
  // Straight horizontal polyline from (0,0) to (0, 0.1) with a vertex in the middle.
  return {
    polyline: encodePolyline([[0, 0], [0, 0.05], [0, 0.1]]),
    meters: 1400,
    seconds: 420,
    via_station_ids: ['s-via'],
  }
}

function setupMatchMedia(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: reduce && q.includes('reduce'),
    media: q,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

function renderMap(
  unitSystem: UnitSystem,
  routeEdge: RouteEdge | null,
  stations: StationSnapshot[] = [FROM, TO, VIA],
) {
  return render(
    <UnitSystemProvider initialValue={unitSystem}>
      <TripRouteMap from={FROM} to={TO} routeEdge={routeEdge} stations={stations} />
    </UnitSystemProvider>,
  )
}

function fireLoad(captureIdx = mapCaptures.length - 1) {
  const capture = mapCaptures[captureIdx]
  if (!capture) throw new Error('no map capture')
  for (const fn of capture.loadHandlers) fn()
}

beforeEach(() => {
  mapCaptures.length = 0
  markerElements.length = 0
  popupInstances.length = 0
  setupMatchMedia(false)
  // Stub rAF so the animation runs synchronously when we advance it.
  let rafSeq = 0
  const rafCallbacks = new Map<number, FrameRequestCallback>()
  ;(globalThis as unknown as { __raf: typeof rafCallbacks }).__raf = rafCallbacks
  ;(globalThis as unknown as { __rafSeq: () => number }).__rafSeq = () => ++rafSeq
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    const id = ++rafSeq
    rafCallbacks.set(id, cb)
    return id
  }) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = ((id: number) => {
    rafCallbacks.delete(id)
  }) as typeof cancelAnimationFrame
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function drainRaf(times = 50, stepMs = 20) {
  const cbs = (globalThis as unknown as { __raf: Map<number, FrameRequestCallback> }).__raf
  // We need the rAF callback to see an advancing clock so the animation
  // actually progresses past t=0. happy-dom's `performance.now()` ticks too
  // slowly between synchronous calls to drive a 600ms ease-out, so we hand
  // each frame an injected timestamp.
  let t = performance.now()
  for (let i = 0; i < times; i++) {
    if (cbs.size === 0) return
    const entries = Array.from(cbs.entries())
    cbs.clear()
    t += stepMs
    for (const [, cb] of entries) cb(t)
  }
}

describe('TripRouteMap distance label', () => {
  it('renders the distance label in imperial units', () => {
    renderMap('imperial', makeRouteEdge())
    act(() => { fireLoad() })
    const label = document.querySelector('[data-testid="trip-route-distance-label"]')
    expect(label).not.toBeNull()
    // 1400 m → 0.9 mi, 420 s → 7 min
    expect(label?.textContent).toMatch(/0\.9\s*mi/)
    expect(label?.textContent).toMatch(/7 min/)
  })

  it('renders the distance label in metric units', () => {
    renderMap('metric', makeRouteEdge())
    act(() => { fireLoad() })
    const label = document.querySelector('[data-testid="trip-route-distance-label"]')
    expect(label?.textContent).toMatch(/1\.4\s*km/)
    expect(label?.textContent).toMatch(/7 min/)
  })

  it('does not render a distance label when there is no routeEdge', () => {
    renderMap('imperial', null)
    act(() => { fireLoad() })
    const label = document.querySelector('[data-testid="trip-route-distance-label"]')
    expect(label).toBeNull()
  })
})

describe('TripRouteMap via pin tooltips', () => {
  it('creates a popup with the via station name and shows it on mouseenter', () => {
    renderMap('imperial', makeRouteEdge())
    act(() => { fireLoad() })
    // Find the via pin element by data attribute we set in the component.
    const viaEl = document.querySelector('[data-via-station-id="s-via"]') as HTMLElement | null
    expect(viaEl).not.toBeNull()
    expect(viaEl?.getAttribute('aria-label')).toBe('Via Station Name')

    // One popup created per via pin.
    expect(popupInstances.length).toBe(1)
    expect(popupInstances[0]?.text).toBe('Via Station Name')

    // Tooltip is not visible until interaction.
    expect(popupInstances[0]?.isOpen()).toBe(false)
    viaEl!.dispatchEvent(new Event('mouseenter'))
    expect(popupInstances[0]?.isOpen()).toBe(true)
    viaEl!.dispatchEvent(new Event('mouseleave'))
    expect(popupInstances[0]?.isOpen()).toBe(false)
  })

  it('toggles the tooltip on tap for touch devices', () => {
    renderMap('imperial', makeRouteEdge())
    act(() => { fireLoad() })
    const viaEl = document.querySelector('[data-via-station-id="s-via"]') as HTMLElement | null
    expect(viaEl).not.toBeNull()
    viaEl!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(popupInstances[0]?.isOpen()).toBe(true)
    viaEl!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(popupInstances[0]?.isOpen()).toBe(false)
  })
})

describe('TripRouteMap polyline draw animation', () => {
  it('schedules a draw animation that incrementally extends the source data', () => {
    renderMap('imperial', makeRouteEdge())
    act(() => { fireLoad() })
    const cap = mapCaptures[0]!
    expect(cap.source).not.toBeNull()

    // Initial source data is a near-zero-length stub.
    const setData = cap.source!.setData
    const callsBefore = setData.mock.calls.length

    act(() => { drainRaf(100) })

    // The animation should have called setData at least a few times.
    expect(setData.mock.calls.length).toBeGreaterThan(callsBefore)
    // Final call should contain the full polyline (3 vertices in our fixture).
    const finalArg = setData.mock.calls.at(-1)?.[0] as
      | { geometry: { coordinates: Array<[number, number]> } }
      | undefined
    expect(finalArg?.geometry.coordinates.length).toBeGreaterThanOrEqual(3)
  })

  it('respects prefers-reduced-motion: skips animation and renders the final polyline up-front', () => {
    setupMatchMedia(true)
    renderMap('imperial', makeRouteEdge())
    act(() => { fireLoad() })
    const cap = mapCaptures[0]!
    // setData was never called — the initial source data already had the full
    // polyline (3 coordinates).
    expect(cap.source!.setData.mock.calls.length).toBe(0)
    const initial = cap.source!.data as { geometry: { coordinates: Array<[number, number]> } }
    expect(initial.geometry.coordinates.length).toBe(3)
  })

  it('animates only once per route prop, not on unrelated re-renders', () => {
    const { rerender } = renderMap('imperial', makeRouteEdge())
    act(() => { fireLoad() })
    const firstCap = mapCaptures[0]!
    act(() => { drainRaf(100) })
    const callsAfterFirst = firstCap.source!.setData.mock.calls.length

    // Re-render with the same props — the effect's dependency tuple is unchanged,
    // so no new animation should start.
    rerender(
      <UnitSystemProvider initialValue="imperial">
        <TripRouteMap from={FROM} to={TO} routeEdge={makeRouteEdge()} stations={[FROM, TO, VIA]} />
      </UnitSystemProvider>,
    )
    // No additional setData calls from a new animation (the old capture is stable).
    expect(firstCap.source!.setData.mock.calls.length).toBe(callsAfterFirst)
  })
})
