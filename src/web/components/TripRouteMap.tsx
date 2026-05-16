import { useEffect, useMemo, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import type { StationSnapshot } from '@shared/types'
import type { RouteEdge } from '@shared/route-cache'
import { decodePolyline } from '@shared/polyline'
import { buildEndpointPin } from '../lib/pin-svg'

const POSITRON_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'

type Props = {
  from: StationSnapshot
  to: StationSnapshot
  routeEdge: RouteEdge | null
  stations: StationSnapshot[]
  className?: string
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

export default function TripRouteMap({ from, to, routeEdge, stations, className }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const stationById = useMemo(() => new Map(stations.map(s => [s.station_id, s])), [stations])

  useEffect(() => {
    if (!containerRef.current) return

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
        : [[from.lon, from.lat], [to.lon, to.lat]]

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

      new maplibregl.Marker({ element: makePinElement('origin'), anchor: 'bottom' })
        .setLngLat([from.lon, from.lat])
        .addTo(map)
      new maplibregl.Marker({ element: makePinElement('destination'), anchor: 'bottom' })
        .setLngLat([to.lon, to.lat])
        .addTo(map)

      if (routeEdge) {
        for (const viaId of routeEdge.via_station_ids) {
          if (viaId === from.station_id || viaId === to.station_id) continue
          const via = stationById.get(viaId)
          if (!via) continue
          new maplibregl.Marker({ element: makePinElement('via'), anchor: 'bottom' })
            .setLngLat([via.lon, via.lat])
            .addTo(map)
        }
      }

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
  }, [from, to, routeEdge, stationById])

  return <div ref={containerRef} className={className} aria-label="Bike route map" />
}
