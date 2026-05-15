import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import maplibregl, { Map as MlMap, Marker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { latLngToCell, cellToBoundary } from 'h3-js'
import { useLiveSnapshot } from '../hooks/useLiveSnapshot'
import { buildPinSVG, pinSize } from '../lib/pin-svg'
import StalenessBadge from '../components/StalenessBadge'
import SystemTotals from '../components/SystemTotals'
import MapViewToggle, { type MapView } from '../components/MapViewToggle'
import BasemapToggle, { type Basemap } from '../components/BasemapToggle'
import { renderSparkline } from '../lib/sparkline'
import type { StationSnapshot } from '@shared/types'

const API_BASE = import.meta.env.VITE_API_BASE ?? ''

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

const SYSTEM_ID = 'bcycle_santabarbara'
const SB_CENTER: [number, number] = [-119.6982, 34.4208]

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
  // BCycle SB is currently all-electric, so the "Electric: N" line is redundant.
  // If non-electric types ever appear, show them so the user knows.
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
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const markersRef = useRef<Map<string, Marker>>(new Map())
  const popupRef = useRef<maplibregl.Popup | null>(null)
  const boundsSetRef = useRef(false)
  const { data, ageSec } = useLiveSnapshot(SYSTEM_ID)
  const { stationId: urlStationId } = useParams<{ stationId: string }>()
  const navigate = useNavigate()
  const [view, setView] = useState<MapView>('pins')
  const [basemap, setBasemap] = useState<Basemap>('clean')

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
      center: SB_CENTER,
      zoom: 13,
    })
    return () => { mapRef.current?.remove(); mapRef.current = null }
    // boot only; we swap style imperatively below when basemap changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

    // First data load: clamp pan + zoom to 1.5x the stations' bbox.
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
      // 1.5x scale-out: 25% padding on each side of the station bbox.
      const latPad = (maxLat - minLat) * 0.25
      const lonPad = (maxLon - minLon) * 0.25
      const bounds: [[number, number], [number, number]] = [
        [minLon - lonPad, minLat - latPad],
        [maxLon + lonPad, maxLat + latPad],
      ]
      map.setMaxBounds(bounds)
      // padding=0 → bounds fill the viewport exactly. The 1.5x scale is the visual margin.
      map.fitBounds(bounds, { padding: 0, duration: 0, animate: false })
      // Lock minZoom to the fit zoom — user can pan within bounds but can't zoom out
      // past the 1.5x view (which would otherwise reveal empty world map).
      map.setMinZoom(map.getZoom())
      boundsSetRef.current = true
    }

    const seen = new Set<string>()

    for (const s of data.stations) {
      seen.add(s.station_id)
      const total = s.num_bikes_available + s.num_docks_available
      const offline = !s.is_installed || !s.is_renting
      const { width, height } = pinSize(total)
      const svg = buildPinSVG(s.num_bikes_available, s.num_docks_available, { offline })

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
      el.innerHTML = svg
      el.title = `${s.name}: ${s.num_bikes_available} bikes / ${s.num_docks_available} docks (total ${total})`

      // rebind click each render so the closure captures the latest station snapshot
      el.onclick = (ev) => {
        ev.stopPropagation()
        navigate(`/station/${s.station_id}`)
      }
    }

    for (const [id, marker] of markersRef.current) {
      if (!seen.has(id)) { marker.remove(); markersRef.current.delete(id) }
    }
  }, [data, view])

  return (
    <div className="relative w-full h-[calc(100vh-49px)]">
      <div ref={ref} className="absolute inset-0" />
      {/* Heatmap view toggle is wired up below but the button is hidden for
         now; bring back once we revisit the heatmap UI direction. */}
      {/* <MapViewToggle value={view} onChange={setView} /> */}
      <BasemapToggle value={basemap} onChange={setBasemap} />
      {data && <StalenessBadge ageSec={ageSec} snapshotTs={data.snapshot_ts} />}
      {data && <SystemTotals stations={data.stations} maxBikesEver={data.max_bikes_ever} recent24h={data.recent24h} timezone={data.system.timezone} snapshotTs={data.snapshot_ts} lastChangedTs={data.last_total_changed_ts} variant="overlay" />}
    </div>
  )
}
