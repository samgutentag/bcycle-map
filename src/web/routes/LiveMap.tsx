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
import type { StationSnapshot } from '@shared/types'

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
const BASEMAP_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'

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
  const types = [
    s.bikes_electric > 0 ? `Electric: ${s.bikes_electric}` : null,
    s.bikes_classic > 0 ? `Classic: ${s.bikes_classic}` : null,
    s.bikes_smart > 0 ? `Smart: ${s.bikes_smart}` : null,
  ].filter(Boolean)

  return `
    <div class="text-sm text-neutral-900">
      <div class="font-semibold">${escapeHtml(s.name)}</div>
      ${s.address ? `<a href="https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lon}" target="_blank" rel="noopener noreferrer" class="text-xs text-sky-700 hover:underline mt-0.5 inline-block">${escapeHtml(s.address)} ↗</a>` : ''}
      <div class="mt-2 flex gap-4">
        <div><span class="font-medium">${s.num_bikes_available}</span> bikes available</div>
        <div><span class="font-medium">${s.num_docks_available}</span> docks available</div>
      </div>
      ${types.length > 0 ? `<div class="mt-2 text-xs text-neutral-600 space-y-0.5">${types.map(t => `<div>${t}</div>`).join('')}</div>` : ''}
      ${offline ? `<div class="mt-2 text-xs font-medium text-red-700">Station offline</div>` : ''}
      <div class="mt-2 text-xs text-neutral-500">Reported ${ageText}</div>
      <div class="mt-3 flex gap-2 text-xs">
        <a href="/route/${encodeURIComponent(s.station_id)}" data-spa class="px-2 py-1 rounded bg-sky-700 text-white hover:bg-sky-800 no-underline">Use as start</a>
        <a href="/route//${encodeURIComponent(s.station_id)}" data-spa class="px-2 py-1 rounded bg-emerald-700 text-white hover:bg-emerald-800 no-underline">Use as destination</a>
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
    popup.on('close', () => {
      if (popupRef.current === popup) navigate('/')
    })
    popupRef.current = popup
  }

  // boot the map once
  useEffect(() => {
    if (!ref.current || mapRef.current) return
    mapRef.current = new maplibregl.Map({
      container: ref.current,
      style: BASEMAP_STYLE,
      center: SB_CENTER,
      zoom: 13,
    })
    return () => { mapRef.current?.remove(); mapRef.current = null }
  }, [])

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
      <MapViewToggle value={view} onChange={setView} />
      {data && <StalenessBadge ageSec={ageSec} snapshotTs={data.snapshot_ts} />}
      {data && <SystemTotals stations={data.stations} maxBikesEver={data.max_bikes_ever} variant="overlay" />}
    </div>
  )
}
