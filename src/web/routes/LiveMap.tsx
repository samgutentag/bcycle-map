import { useEffect, useRef } from 'react'
import maplibregl, { Map as MlMap, Marker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useLiveSnapshot } from '../hooks/useLiveSnapshot'
import { markerColor, markerSize, pctAvailable } from '../lib/marker-style'
import StalenessBadge from '../components/StalenessBadge'

const SYSTEM_ID = 'bcycle_santabarbara'
const SB_CENTER: [number, number] = [-119.6982, 34.4208]
const BASEMAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

export default function LiveMap() {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const markersRef = useRef<Map<string, Marker>>(new Map())
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

      const existing = markersRef.current.get(s.station_id)
      if (existing) {
        const el = existing.getElement()
        el.style.backgroundColor = color
        el.style.width = el.style.height = `${size}px`
        continue
      }

      const el = document.createElement('div')
      el.className = 'rounded-full border border-neutral-900'
      el.style.backgroundColor = color
      el.style.width = el.style.height = `${size}px`
      el.title = `${s.name}: ${s.num_bikes_available} bikes / ${s.num_docks_available} docks`

      const marker = new maplibregl.Marker(el).setLngLat([s.lon, s.lat]).addTo(map)
      markersRef.current.set(s.station_id, marker)
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
