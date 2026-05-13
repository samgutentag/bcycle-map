import { useEffect, useRef } from 'react'
import maplibregl, { Map as MlMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { HexagonLayer } from '@deck.gl/aggregation-layers'
import { useStationSnapshots } from '../hooks/useStationSnapshots'

const SB_CENTER: [number, number] = [-119.6982, 34.4208]
const BASEMAP_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'

type Props = { baseUrl: string; system: string; atTs: number }

export default function SpatialDensityMap({ baseUrl, system, atTs }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const overlayRef = useRef<MapboxOverlay | null>(null)
  const { data, loading } = useStationSnapshots({ baseUrl, system, atTs })

  useEffect(() => {
    if (!ref.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: ref.current,
      style: BASEMAP_STYLE,
      center: SB_CENTER,
      zoom: 13,
    })
    const overlay = new MapboxOverlay({ layers: [] })
    map.addControl(overlay as any)
    mapRef.current = map
    overlayRef.current = overlay
    return () => {
      map.remove()
      mapRef.current = null
      overlayRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!overlayRef.current || !data) return
    const layer = new HexagonLayer({
      id: 'station-hex',
      data,
      getPosition: (d: any) => [d.lon, d.lat],
      getElevationWeight: (d: any) => d.num_bikes_available,
      radius: 200,
      elevationScale: 12,
      extruded: true,
      coverage: 0.85,
      opacity: 0.6,
    })
    overlayRef.current.setProps({ layers: [layer] })
  }, [data])

  return (
    <div className="relative w-full h-[500px] rounded-lg overflow-hidden border border-neutral-200">
      <div ref={ref} className="absolute inset-0" />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 text-neutral-600">
          Loading hex aggregation...
        </div>
      )}
    </div>
  )
}
