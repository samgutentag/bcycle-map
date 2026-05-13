import { useEffect, useRef } from 'react'
import maplibregl, { Map as MlMap, Marker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useLiveSnapshot } from '../hooks/useLiveSnapshot'
import { markerColor, markerSize, pctAvailable } from '../lib/marker-style'
import StalenessBadge from '../components/StalenessBadge'
import type { StationSnapshot } from '@shared/types'

const SYSTEM_ID = 'bcycle_santabarbara'
const SB_CENTER: [number, number] = [-119.6982, 34.4208]
const BASEMAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

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
      ${s.address ? `<div class="text-xs text-neutral-500 mt-0.5">${escapeHtml(s.address)}</div>` : ''}
      <div class="mt-2 flex gap-4">
        <div><span class="font-medium">${s.num_bikes_available}</span> bikes</div>
        <div><span class="font-medium">${s.num_docks_available}</span> docks</div>
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
  const { data, ageSec } = useLiveSnapshot(SYSTEM_ID)

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

  // sync markers when data updates
  useEffect(() => {
    if (!mapRef.current || !data) return
    const map = mapRef.current
    const seen = new Set<string>()

    for (const s of data.stations) {
      seen.add(s.station_id)
      const pct = pctAvailable({ bikes: s.num_bikes_available, docks: s.num_docks_available })
      const color = markerColor(pct)
      const size = markerSize(s.num_bikes_available + s.num_docks_available)

      let marker = markersRef.current.get(s.station_id)
      let el: HTMLElement
      if (marker) {
        el = marker.getElement()
      } else {
        el = document.createElement('div')
        el.className = 'rounded-full border border-neutral-900 cursor-pointer'
        marker = new maplibregl.Marker(el).setLngLat([s.lon, s.lat]).addTo(map)
        markersRef.current.set(s.station_id, marker)
      }

      el.style.backgroundColor = color
      el.style.width = el.style.height = `${size}px`
      el.title = `${s.name}: ${s.num_bikes_available} bikes / ${s.num_docks_available} docks`

      // rebind click each render so the closure captures the latest station snapshot
      el.onclick = (ev) => {
        ev.stopPropagation()
        popupRef.current?.remove()
        popupRef.current = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '280px' })
          .setLngLat([s.lon, s.lat])
          .setHTML(buildPopupHTML(s, Math.floor(Date.now() / 1000)))
          .addTo(map)
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
    </div>
  )
}
