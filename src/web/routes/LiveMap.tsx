import { useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import maplibregl, { Map as MlMap, Marker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useLiveSnapshot } from '../hooks/useLiveSnapshot'
import { buildPinSVG, pinSize } from '../lib/pin-svg'
import StalenessBadge from '../components/StalenessBadge'
import SystemTotals from '../components/SystemTotals'
import type { StationSnapshot } from '@shared/types'

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

  // sync markers when data updates
  useEffect(() => {
    if (!mapRef.current || !data) return
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
  }, [data])

  return (
    <div className="relative w-full h-[calc(100vh-49px)]">
      <div ref={ref} className="absolute inset-0" />
      {data && <StalenessBadge ageSec={ageSec} snapshotTs={data.snapshot_ts} />}
      {data && <SystemTotals stations={data.stations} maxBikesEver={data.max_bikes_ever} variant="overlay" />}
    </div>
  )
}
