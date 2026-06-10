import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import maplibregl, { Map as MlMap, Marker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { latLngToCell, cellToBoundary } from 'h3-js'
import { useLiveSnapshot } from '../hooks/useLiveSnapshot'
import { useActivity } from '../hooks/useActivity'
import { buildPinSVG, pinSize } from '../lib/pin-svg'
import StalenessBadge from '../components/StalenessBadge'
import SystemTotals from '../components/SystemTotals'
import MapViewToggle, { type MapView } from '../components/MapViewToggle'
import BasemapToggle, { type Basemap } from '../components/BasemapToggle'
import TypicalComparisonToggle from '../components/TypicalComparisonToggle'
import PollPinger from '../components/PollPinger'
import MapFilterChips from '../components/MapFilterChips'
import MobileSettingsSheet from '../components/MobileSettingsSheet'
import { renderSparkline } from '../lib/sparkline'
import { trackEvent } from '../lib/analytics'
import { diffSnapshots, type PulseDirection } from '../lib/pin-pulse'
import { assignmentMap, type CorridorId } from '../config/corridors'
import { useCorridors } from '../hooks/useCorridors'
import {
  applyMapFilters,
  DEFAULT_FILTERS,
  readFiltersFromSearch,
  writeFiltersToSearch,
} from '../lib/map-filters'
import { classifyTypical, ringToneFor } from '../lib/typical-comparison'
import { useTypicalProfiles } from '../hooks/useTypicalProfiles'
import { useSystem } from '../context/SystemContext'
import type { StationSnapshot } from '@shared/types'

const TYPICAL_LS_KEY = 'bcycle-map:show-typical-comparison'

function readTypicalToggle(): boolean {
  if (typeof window === 'undefined') return true
  const v = window.localStorage.getItem(TYPICAL_LS_KEY)
  // Default ON per spec; only an explicit '0' turns it off.
  return v !== '0'
}

const PULSE_DURATION_MS = 800

const API_BASE = import.meta.env.VITE_API_BASE ?? ''
const R2_BASE = import.meta.env.VITE_R2_PUBLIC_URL ?? 'https://pub-83059e704dd64536a5166ab289eb42e5.r2.dev'

const POSITRON_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
const CYCLOSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    cyclosm: {
      type: 'raster',
      tiles: [
        'https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
        'https://b.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
        'https://c.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors · CyclOSM',
    },
  },
  layers: [{ id: 'cyclosm', type: 'raster', source: 'cyclosm' }],
}

const HEX_RES = 10  // ~0.065 km hexes — block-level granularity; most stations get their own hex
const HEX_SOURCE_ID = 'station-hex'
const HEX_FILL_LAYER = 'station-hex-fill'
const HEX_LINE_LAYER = 'station-hex-line'

function stationsToHexGeoJSON(stations: StationSnapshot[]) {
  type Agg = { bikes: number; docks: number; stations: number; names: string[] }
  const byHex = new Map<string, Agg>()
  for (const s of stations) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue
    const h3 = latLngToCell(s.lat, s.lon, HEX_RES)
    const cur = byHex.get(h3) ?? { bikes: 0, docks: 0, stations: 0, names: [] }
    cur.bikes += s.num_bikes_available
    cur.docks += s.num_docks_available
    cur.stations += 1
    cur.names.push(s.name)
    byHex.set(h3, cur)
  }
  return {
    type: 'FeatureCollection' as const,
    features: [...byHex.entries()].map(([h3, agg]) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Polygon' as const,
        // h3-js v4: cellToBoundary(h3, true) returns [lng, lat] pairs
        coordinates: [cellToBoundary(h3, true) as [number, number][]],
      },
      properties: { ...agg, hex: h3 },
    })),
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  return `${Math.floor(seconds / 3600)}h ago`
}

function buildPopupHTML(s: StationSnapshot, nowTs: number): string {
  const ageSec = Math.max(0, nowTs - s.last_reported)
  const ageText = formatAge(ageSec)
  const offline = !s.is_renting || !s.is_returning || !s.is_installed
  // Many BCycle systems are all-electric, so an "Electric: N" line is usually
  // redundant. Show classic/smart counts only when a system actually has them.
  const types = [
    s.bikes_classic > 0 ? `Classic: ${s.bikes_classic}` : null,
    s.bikes_smart > 0 ? `Smart: ${s.bikes_smart}` : null,
  ].filter(Boolean)

  // Inline styles rather than Tailwind classes — the popup mounts inside MapLibre's
  // DOM, which lives outside React, so it can't pick up Harmony's emotion classes.
  // Using --app-* CSS variables ties popup colors to the active theme.
  return `
    <div style="font-size:13px;color:var(--app-text);font-family:var(--harmony-font-family,system-ui);min-width:220px">
      <div style="font-weight:700;color:var(--app-text-heading);font-size:14px">${escapeHtml(s.name)}</div>
      ${s.address ? `<a href="https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lon}" target="_blank" rel="noopener noreferrer" style="font-size:11px;color:var(--app-accent);text-decoration:none;margin-top:2px;display:inline-block">${escapeHtml(s.address)} ↗</a>` : ''}
      <div style="margin-top:8px;display:flex;gap:18px;font-size:12px">
        <div><span style="font-weight:600;color:var(--app-text-heading);font-size:14px">${s.num_bikes_available}</span> <span style="color:var(--app-text-subdued)">bikes</span></div>
        <div><span style="font-weight:600;color:var(--app-text-heading);font-size:14px">${s.num_docks_available}</span> <span style="color:var(--app-text-subdued)">docks</span></div>
      </div>
      ${types.length > 0 ? `<div style="margin-top:8px;font-size:11px;color:var(--app-text-subdued);display:flex;flex-direction:column;gap:2px">${types.map(t => `<div>${t}</div>`).join('')}</div>` : ''}
      ${offline ? `<div style="margin-top:8px;font-size:11px;font-weight:600;color:var(--app-danger);text-transform:uppercase;letter-spacing:0.04em">Station offline</div>` : ''}
      <div style="margin-top:8px;font-size:11px;color:var(--app-text-subdued)">Reported ${ageText}</div>
      ${s.first_seen_ts ? `<div style="font-size:11px;color:var(--app-text-subdued)">Active station as of ${new Date(s.first_seen_ts * 1000).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</div>` : ''}
      <div style="margin-top:10px">
        <div data-sparkline="${escapeHtml(s.station_id)}" style="display:block"></div>
        <div style="display:flex;gap:10px;font-size:10px;color:var(--app-text-subdued);margin-top:4px">
          <span style="display:inline-flex;align-items:center;gap:4px"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:#0d6cb0;opacity:0.85"></span>Typical</span>
          <span style="display:inline-flex;align-items:center;gap:4px"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:#ea580c"></span>Now</span>
        </div>
      </div>
      <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px;font-size:12px">
        <a href="/station/${encodeURIComponent(s.station_id)}/details" data-spa style="padding:5px 10px;border-radius:6px;background:var(--app-text-heading);color:var(--app-bg-surface);text-decoration:none;font-weight:600">Open details →</a>
      </div>
    </div>
  `
}

export default function LiveMap() {
  const { systemId: SYSTEM_ID, activeSystem } = useSystem()
  const bootCenter: [number, number] = activeSystem?.centroid ?? [-119.6982, 34.4208]
  const bootCenterRef = useRef(bootCenter)
  bootCenterRef.current = bootCenter
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const markersRef = useRef<Map<string, Marker>>(new Map())
  const popupRef = useRef<maplibregl.Popup | null>(null)
  const boundsSetRef = useRef(false)
  // Previous snapshot's stations — used to diff against the next tick so we can
  // pulse just the pins whose bike count actually moved.
  const prevStationsRef = useRef<StationSnapshot[] | null>(null)
  // Per-station pulse queue. Each entry tracks the active timeout and the next
  // queued direction so we only run one pulse at a time but never drop a tick.
  const pulseStateRef = useRef<Map<string, { timer: number; queued: PulseDirection | null }>>(new Map())
  const { data, ageSec } = useLiveSnapshot(SYSTEM_ID)
  const { data: activity } = useActivity(SYSTEM_ID)
  const { stationId: urlStationId } = useParams<{ stationId: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [view, setView] = useState<MapView>('pins')
  const [basemap, setBasemap] = useState<Basemap>('clean')
  // Typical-comparison ring toggle (#39). Hydrate from localStorage so the
  // user's last choice survives reload; persist on every change.
  const [showTypical, setShowTypicalState] = useState<boolean>(() => readTypicalToggle())
  const setShowTypical = useCallback((next: boolean) => {
    setShowTypicalState(next)
    try {
      window.localStorage.setItem(TYPICAL_LS_KEY, next ? '1' : '0')
    } catch {
      // localStorage access can throw in private/quota'd contexts — toggle
      // still works in-session, the choice just won't persist.
    }
  }, [])
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Filter chips. URL-driven (`?bikes=N&corridor=…`) so links are shareable
  // and round-trip safely across reloads.
  const filters = useMemo(() => readFiltersFromSearch(searchParams), [searchParams])
  const setMinBikes = useCallback((value: number) => {
    setSearchParams(prev => writeFiltersToSearch(prev, { ...readFiltersFromSearch(prev), minBikes: value }), { replace: true })
  }, [setSearchParams])
  const setCorridor = useCallback((value: CorridorId | null) => {
    setSearchParams(prev => writeFiltersToSearch(prev, { ...readFiltersFromSearch(prev), corridor: value }), { replace: true })
  }, [setSearchParams])
  const resetFilters = useCallback(() => {
    setSearchParams(prev => writeFiltersToSearch(prev, DEFAULT_FILTERS), { replace: true })
  }, [setSearchParams])

  // Memoize the station → corridor lookup; iterates every station each
  // snapshot but identity is stable across renders, so the filter effect
  // only re-runs when the snapshot itself changes.
  const { data: corridorArtifact } = useCorridors(R2_BASE, SYSTEM_ID)
  const corridorByStation = useMemo(
    () => assignmentMap(corridorArtifact),
    [corridorArtifact],
  )

  // Filter the station list driving the markers. SystemTotals always sees the
  // full snapshot — totals are system-wide by design (per the spec).
  const visibleStations = useMemo<StationSnapshot[]>(() => {
    if (!data) return []
    return applyMapFilters(data.stations, filters, corridorByStation)
  }, [data, filters, corridorByStation])

  // Fetch the typical-vs-now profile for every station in the snapshot. We
  // pass the full station list rather than just `visibleStations` so chip
  // toggles (which narrow the visible set) don't re-trigger network — the
  // profiles are needed only when the ring is enabled.
  const allStationIds = useMemo(
    () => (data?.stations ?? []).map(s => s.station_id).sort(),
    [data?.stations],
  )
  const typicalProfiles = useTypicalProfiles(API_BASE, SYSTEM_ID, allStationIds, showTypical)

  // Trigger a single pulse on a marker. If one is already running for that
  // station, queue the latest direction instead (we only ever keep the most
  // recent queued event; older queued events are coalesced away).
  function triggerPulse(stationId: string, direction: PulseDirection) {
    const marker = markersRef.current.get(stationId)
    if (!marker) return
    const el = marker.getElement()
    const state = pulseStateRef.current
    const existing = state.get(stationId)
    if (existing) {
      existing.queued = direction
      return
    }
    runPulse(el, stationId, direction)
  }

  function runPulse(el: HTMLElement, stationId: string, direction: PulseDirection) {
    // Reset first so back-to-back pulses on the same element actually re-run
    // the CSS animation rather than silently being a no-op.
    el.classList.remove('pin-pulse')
    el.removeAttribute('data-pulse')
    // Force layout flush so the next class add restarts the keyframe cleanly.
    void el.offsetWidth
    el.dataset.pulse = direction
    el.classList.add('pin-pulse')
    const timer = window.setTimeout(() => {
      el.classList.remove('pin-pulse')
      el.removeAttribute('data-pulse')
      const next = pulseStateRef.current.get(stationId)?.queued ?? null
      pulseStateRef.current.delete(stationId)
      if (next) runPulse(el, stationId, next)
    }, PULSE_DURATION_MS)
    pulseStateRef.current.set(stationId, { timer, queued: null })
  }

  function openStationPopup(s: StationSnapshot, map: MlMap, fly: boolean) {
    // Clear ref BEFORE removing the old popup so its close event doesn't
    // misread this as a user dismissal and navigate us back to '/'.
    const oldPopup = popupRef.current
    popupRef.current = null
    oldPopup?.remove()

    if (fly) {
      map.flyTo({ center: [s.lon, s.lat], zoom: 15, duration: 800 })
    }
    const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '280px' })
      .setLngLat([s.lon, s.lat])
      .setHTML(buildPopupHTML(s, Math.floor(Date.now() / 1000)))
      .addTo(map)
    trackEvent('station_opened', { stationId: s.station_id, stationName: s.name, source: 'pin' })
    // Intercept clicks on `data-spa` anchors so they use SPA navigation instead
    // of a full page reload (preserves the MapLibre instance and is much faster).
    popup.getElement()?.addEventListener('click', ev => {
      const target = ev.target as HTMLElement | null
      const anchor = target?.closest('a[data-spa]') as HTMLAnchorElement | null
      if (!anchor) return
      ev.preventDefault()
      const href = anchor.getAttribute('href')
      if (href) navigate(href)
    })
    // Fire off the sparkline render (async; no-ops if popup closes first)
    const sparklineEl = popup.getElement()?.querySelector(`[data-sparkline="${s.station_id}"]`) as HTMLElement | null
    if (sparklineEl) {
      renderSparkline(sparklineEl, API_BASE, SYSTEM_ID, s.station_id, s.num_bikes_available)
    }
    popup.on('close', () => {
      if (popupRef.current !== popup) return
      // Only navigate home if the URL still represents *this* popup being
      // the focus. If the user has navigated to /details or elsewhere, the
      // popup is being destroyed as part of route change, not user dismissal.
      const expected = `/station/${s.station_id}`
      const pathname = window.location.pathname
      if (pathname === expected || pathname === `${expected}/`) navigate('/')
    })
    popupRef.current = popup
  }

  // boot the map once
  useEffect(() => {
    if (!ref.current || mapRef.current) return
    mapRef.current = new maplibregl.Map({
      container: ref.current,
      style: basemap === 'cycling' ? CYCLOSM_STYLE : POSITRON_STYLE,
      center: bootCenterRef.current,
      zoom: 13,
    })
    return () => { mapRef.current?.remove(); mapRef.current = null }
    // boot only; we swap style imperatively below when basemap changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-fit the camera when the active system changes. Snap to the new
  // system's bbox from the systems index IMMEDIATELY (no waiting on its
  // station fetch), then clear the gate so the marker-sync effect refines
  // to the precise station bounds once the new snapshot lands.
  useEffect(() => {
    boundsSetRef.current = false
    const map = mapRef.current
    const bbox = activeSystem?.bbox
    if (!map || !bbox) return
    map.setMinZoom(0) // drop the floor set for the previous system before refitting
    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 40, duration: 400 })
  }, [SYSTEM_ID, activeSystem])

  // swap basemap style when toggle changes
  useEffect(() => {
    if (!mapRef.current) return
    boundsSetRef.current = false  // re-fit bounds on next data render since style reset clears layers
    mapRef.current.setStyle(basemap === 'cycling' ? CYCLOSM_STYLE : POSITRON_STYLE)
  }, [basemap])

  // open the popup whenever URL or data resolves a station
  useEffect(() => {
    if (!mapRef.current || !data || !urlStationId) return
    const station = data.stations.find(s => s.station_id === urlStationId)
    if (!station) return
    openStationPopup(station, mapRef.current, true)
  }, [urlStationId, data])

  // Manage the H3 hex heatmap layer. View 'bikes' or 'docks' adds (or updates)
  // the source + fill layer using the matching property. 'pins' removes it.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !data) return
    const isHeatmap = view === 'bikes' || view === 'docks'
    if (isHeatmap) {
      const geojson = stationsToHexGeoJSON(data.stations)
      // Bikes = blue, docks = green. Lighter steps fade to near-transparent so
      // empty areas don't visually clutter the map.
      const colorStops: Array<[number, string]> = view === 'bikes'
        ? [
          [0, 'rgba(13, 108, 176, 0.10)'],
          [5, 'rgba(13, 108, 176, 0.35)'],
          [15, 'rgba(13, 108, 176, 0.55)'],
          [30, 'rgba(13, 108, 176, 0.75)'],
          [60, 'rgba(13, 108, 176, 0.9)'],
        ]
        : [
          [0, 'rgba(21, 128, 61, 0.10)'],
          [5, 'rgba(21, 128, 61, 0.35)'],
          [15, 'rgba(21, 128, 61, 0.55)'],
          [30, 'rgba(21, 128, 61, 0.75)'],
          [60, 'rgba(21, 128, 61, 0.9)'],
        ]
      const fillColor: any = ['interpolate', ['linear'], ['get', view]]
      for (const [v, c] of colorStops) {
        fillColor.push(v, c)
      }
      const lineColor = view === 'bikes' ? 'rgba(13, 108, 176, 0.6)' : 'rgba(21, 128, 61, 0.6)'

      const apply = () => {
        if (map.getLayer(HEX_FILL_LAYER)) map.removeLayer(HEX_FILL_LAYER)
        if (map.getLayer(HEX_LINE_LAYER)) map.removeLayer(HEX_LINE_LAYER)
        if (map.getSource(HEX_SOURCE_ID)) map.removeSource(HEX_SOURCE_ID)
        map.addSource(HEX_SOURCE_ID, { type: 'geojson', data: geojson as any })
        map.addLayer({
          id: HEX_FILL_LAYER,
          type: 'fill',
          source: HEX_SOURCE_ID,
          paint: { 'fill-color': fillColor, 'fill-opacity': 1 },
        })
        map.addLayer({
          id: HEX_LINE_LAYER,
          type: 'line',
          source: HEX_SOURCE_ID,
          paint: { 'line-color': lineColor, 'line-width': 0.8 },
        })
      }
      if (map.isStyleLoaded()) apply()
      else map.once('load', apply)
    } else {
      if (map.getLayer(HEX_FILL_LAYER)) map.removeLayer(HEX_FILL_LAYER)
      if (map.getLayer(HEX_LINE_LAYER)) map.removeLayer(HEX_LINE_LAYER)
      if (map.getSource(HEX_SOURCE_ID)) map.removeSource(HEX_SOURCE_ID)
    }
  }, [data, view])

  // sync markers when data updates
  useEffect(() => {
    if (!mapRef.current || !data) return
    if (view !== 'pins') {
      // Hide all pins while a heatmap is active
      for (const [id, m] of markersRef.current) {
        m.remove()
        markersRef.current.delete(id)
      }
      return
    }
    const map = mapRef.current

    // First data load: clamp pan + zoom to 1.5x the stations' bbox. Fit to
    // the FULL station set (not the filtered one) so the camera stays put
    // when the user toggles chips — otherwise the visible area would jitter
    // as filters narrow the bbox.
    if (!boundsSetRef.current && data.stations.length > 0) {
      const valid = data.stations.filter(s =>
        Number.isFinite(s.lat) && Number.isFinite(s.lon) && s.lat !== 0 && s.lon !== 0,
      )
      if (valid.length === 0) {
        boundsSetRef.current = true
        return
      }
      const lats = valid.map(s => s.lat)
      const lons = valid.map(s => s.lon)
      const minLat = Math.min(...lats), maxLat = Math.max(...lats)
      const minLon = Math.min(...lons), maxLon = Math.max(...lons)
      const latPad = (maxLat - minLat) * 0.15
      const lonPad = (maxLon - minLon) * 0.15
      const fitBounds: [[number, number], [number, number]] = [
        [minLon - lonPad, minLat - latPad],
        [maxLon + lonPad, maxLat + latPad],
      ]
      map.fitBounds(fitBounds, { padding: 0, duration: 0, animate: false })
      map.setMinZoom(map.getZoom() - 1)
      boundsSetRef.current = true
    }

    const seen = new Set<string>()

    // visibleStations already has the filter applied; stations not in this
    // list won't be added to `seen`, so the sweep at the bottom of this
    // effect removes their markers — exactly the hide-not-grey behavior the
    // spec calls for.
    for (const s of visibleStations) {
      seen.add(s.station_id)
      const total = s.num_bikes_available + s.num_docks_available
      const offline = !s.is_installed || !s.is_renting
      const { width, height } = pinSize(total)
      // Ring is computed per-render so it reacts to both the toggle and the
      // bike count changing on the next snapshot tick. Profile lookup
      // returns undefined while the fetch is in flight → classifyTypical
      // treats that as 'unavailable' → no ring (the safe default).
      const profile = showTypical ? typicalProfiles.get(s.station_id) ?? null : null
      const ringTone = ringToneFor(classifyTypical(s.num_bikes_available, profile).verdict)
      const NEW_STATION_SEC = 14 * 86400
      const isNew = !!s.first_seen_ts && (Math.floor(Date.now() / 1000) - s.first_seen_ts) < NEW_STATION_SEC
      const svg = buildPinSVG(s.num_bikes_available, s.num_docks_available, { offline, ringTone, isNew })

      let marker = markersRef.current.get(s.station_id)
      let el: HTMLElement
      if (marker) {
        el = marker.getElement()
      } else {
        el = document.createElement('div')
        el.style.cursor = 'pointer'
        marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([s.lon, s.lat])
          .addTo(map)
        markersRef.current.set(s.station_id, marker)
      }

      el.style.width = `${width}px`
      el.style.height = `${height}px`
      el.innerHTML = ''
      el.title = `${s.name}: ${s.num_bikes_available} bikes / ${s.num_docks_available} docks (total ${total})`

      const wrapper = document.createElement('div')
      wrapper.style.position = 'relative'
      wrapper.style.width = '100%'
      wrapper.style.height = '100%'
      wrapper.innerHTML = svg

      if (isNew) {
        const badge = document.createElement('span')
        badge.textContent = 'NEW'
        Object.assign(badge.style, {
          position: 'absolute',
          top: '-6px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#f59e0b',
          color: 'white',
          fontSize: '7px',
          fontWeight: '800',
          padding: '1px 4px',
          borderRadius: '4px',
          letterSpacing: '0.05em',
          lineHeight: '1.2',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
        })
        wrapper.appendChild(badge)
      }

      el.appendChild(wrapper)

      // rebind click each render so the closure captures the latest station snapshot
      el.onclick = (ev) => {
        ev.stopPropagation()
        navigate(`/station/${s.station_id}`)
      }
    }

    for (const [id, marker] of markersRef.current) {
      if (!seen.has(id)) { marker.remove(); markersRef.current.delete(id) }
    }
  }, [data, view, visibleStations, showTypical, typicalProfiles])

  // Diff successive snapshots and pulse each pin whose bike count changed.
  // Runs after the marker-sync effect, so markers for new stations exist by
  // the time we look them up. Reduced-motion users get no animation at all.
  useEffect(() => {
    if (!data) return
    if (view !== 'pins') {
      // Heatmap views have no pins to pulse; reset baseline so we don't fire
      // a flurry when the user switches back.
      prevStationsRef.current = data.stations
      return
    }
    const prev = prevStationsRef.current
    prevStationsRef.current = data.stations
    if (!prev) return  // first tick: just record baseline
    const reduceMotion = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) return
    const events = diffSnapshots(prev, data.stations)
    if (events.length === 0) return
    // Batch via a single rAF so 50+ pulses on one tick coalesce into one
    // paint rather than queuing N separate style writes.
    const raf = window.requestAnimationFrame(() => {
      for (const ev of events) triggerPulse(ev.stationId, ev.direction)
    })
    return () => window.cancelAnimationFrame(raf)
    // triggerPulse is stable via refs; data is the only meaningful dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, view])

  // Clear any pending pulse timers on unmount so we don't poke a detached DOM.
  useEffect(() => {
    return () => {
      for (const { timer } of pulseStateRef.current.values()) {
        window.clearTimeout(timer)
      }
      pulseStateRef.current.clear()
    }
  }, [])

  return (
    <div className="relative w-full" style={{ height: 'calc(100dvh - 49px)', overflow: 'hidden' }}>
      <div ref={ref} className="absolute inset-0" />
      {/* Heatmap view toggle is wired up below but the button is hidden for
         now; bring back once we revisit the heatmap UI direction. */}
      {/* <MapViewToggle value={view} onChange={setView} /> */}
      {/* Desktop controls — hidden on mobile, replaced by gear sheet */}
      <div css={{ '@media (max-width: 600px)': { display: 'none' } }}>
        {/* <BasemapToggle value={basemap} onChange={setBasemap} /> */}
        <MapFilterChips
          minBikes={filters.minBikes}
          corridor={filters.corridor}
          corridors={corridorArtifact?.corridors ?? []}
          onCorridorChange={setCorridor}
          onMinBikesChange={setMinBikes}
          onReset={resetFilters}
          filteredCount={visibleStations.length}
          totalCount={data?.stations.length ?? 0}
        />
      </div>
      {/* StalenessBadge removed — the live tile header shows "Updated Xm ago" */}
      {data && (
        <SystemTotals
          stations={data.stations}
          maxBikesEver={data.max_bikes_ever}
          recent24h={data.recent24h}
          timezone={data.system.timezone}
          snapshotTs={data.snapshot_ts}
          lastChangedTs={data.last_total_changed_ts}
          variant="overlay"
          recentEvents={activity?.events ?? []}
        />
      )}
      {/* Mobile gear button */}
      <button
        type="button"
        onClick={() => setSettingsOpen(true)}
        aria-label="Map settings"
        title="Settings"
        css={{
          all: 'unset',
          cursor: 'pointer',
          position: 'absolute',
          top: 8,
          right: 8,
          zIndex: 10,
          width: 40,
          height: 40,
          borderRadius: '50%',
          display: 'none',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--app-bg-surface, white)',
          boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
          border: '1px solid rgba(0,0,0,0.08)',
          fontSize: 18,
          '@media (max-width: 600px)': { display: 'inline-flex' },
        }}
      >
        ⚙
      </button>
      <MobileSettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)}>
        {/* <BasemapToggle value={basemap} onChange={setBasemap} /> */}
        <MapFilterChips
          minBikes={filters.minBikes}
          corridor={filters.corridor}
          corridors={corridorArtifact?.corridors ?? []}
          onCorridorChange={setCorridor}
          onMinBikesChange={setMinBikes}
          onReset={resetFilters}
          filteredCount={visibleStations.length}
          totalCount={data?.stations.length ?? 0}
        />
      </MobileSettingsSheet>
    </div>
  )
}
