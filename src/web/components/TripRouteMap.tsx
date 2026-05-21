import { useEffect, useMemo, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import type { StationSnapshot } from '@shared/types'
import type { RouteEdge } from '@shared/route-cache'
import { decodePolyline } from '@shared/polyline'
import { buildEndpointPin } from '../lib/pin-svg'
import { useUnitSystem } from '../hooks/useUnitSystem'
import { formatDistance } from '../lib/units'

const POSITRON_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
const DRAW_ANIMATION_MS = 600

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
  // Endpoint pins stay pointer-event-free (they purposely don't intercept clicks),
  // but via pins do — they need to receive hover/tap to show the tooltip.
  wrapper.style.pointerEvents = role === 'via' ? 'auto' : 'none'
  if (role === 'via') wrapper.style.cursor = 'pointer'
  return wrapper
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * Length of each segment plus the cumulative length up to that segment's start.
 * Used by `coordsAtFraction` to walk the polyline by a normalized arc-length
 * fraction in O(log n) via the segment index, or O(n) walk-and-stop which is
 * fine for the small (<200 vertex) polylines we cache.
 */
function buildCumulative(coords: Array<[number, number]>): { segLengths: number[]; cumulative: number[]; total: number } {
  const segLengths: number[] = []
  const cumulative: number[] = [0]
  let total = 0
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]
    const b = coords[i]
    if (!a || !b) continue
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy)
    segLengths.push(len)
    total += len
    cumulative.push(total)
  }
  return { segLengths, cumulative, total }
}

/**
 * Return the polyline truncated at `fraction` of its total arc length.
 * The last point is interpolated between the bracketing vertices so the line
 * grows smoothly, not in vertex-sized jumps.
 */
function coordsUpToFraction(
  coords: Array<[number, number]>,
  cumulative: number[],
  total: number,
  fraction: number,
): Array<[number, number]> {
  if (coords.length < 2 || total === 0) return coords
  const target = Math.max(0, Math.min(1, fraction)) * total
  if (target >= total) return coords
  const out: Array<[number, number]> = []
  for (let i = 0; i < coords.length; i++) {
    const c = coords[i]
    const cumAtVertex = cumulative[i] ?? 0
    if (!c) continue
    if (cumAtVertex <= target) {
      out.push(c)
      continue
    }
    // We've stepped past the target — interpolate between the previous vertex
    // and this one, then stop.
    const prev = coords[i - 1]
    const prevCum = cumulative[i - 1] ?? 0
    if (!prev) break
    const segLen = cumAtVertex - prevCum
    const into = segLen === 0 ? 0 : (target - prevCum) / segLen
    out.push([prev[0] + (c[0] - prev[0]) * into, prev[1] + (c[1] - prev[1]) * into])
    break
  }
  return out.length >= 2 ? out : coords.slice(0, 2)
}

/**
 * Midpoint vertex of a polyline by arc length (not by index). Returns the
 * actual midpoint coordinate plus a unit perpendicular vector to the local
 * line direction — used to offset the distance label off the line when it
 * would otherwise collide with the bike emoji / endpoint markers.
 */
function midpointWithPerpendicular(coords: Array<[number, number]>): {
  lng: number
  lat: number
  perp: [number, number]
} | null {
  if (coords.length < 2) return null
  const { cumulative, total } = buildCumulative(coords)
  if (total === 0) return null
  const target = total / 2
  for (let i = 1; i < coords.length; i++) {
    const cumAt = cumulative[i] ?? 0
    if (cumAt < target) continue
    const prev = coords[i - 1]
    const cur = coords[i]
    const prevCum = cumulative[i - 1] ?? 0
    if (!prev || !cur) break
    const segLen = cumAt - prevCum
    const into = segLen === 0 ? 0 : (target - prevCum) / segLen
    const lng = prev[0] + (cur[0] - prev[0]) * into
    const lat = prev[1] + (cur[1] - prev[1]) * into
    const dx = cur[0] - prev[0]
    const dy = cur[1] - prev[1]
    const mag = Math.hypot(dx, dy) || 1
    // Perpendicular in screen-ish space (lng, lat): rotate 90deg.
    return { lng, lat, perp: [-dy / mag, dx / mag] }
  }
  // Fallback: midpoint by index for degenerate inputs.
  const mid = coords[Math.floor(coords.length / 2)] ?? coords[0]!
  return { lng: mid[0], lat: mid[1], perp: [0, 1] }
}

function formatMinutes(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60))
  return `${m} min`
}

function makeDistanceLabelElement(text: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'trip-route-distance-label'
  el.setAttribute('data-testid', 'trip-route-distance-label')
  el.textContent = text
  el.style.pointerEvents = 'none'
  el.style.padding = '2px 6px'
  el.style.background = '#ffffff'
  el.style.color = '#1f2937'
  el.style.fontSize = '11px'
  el.style.fontWeight = '600'
  el.style.lineHeight = '1.4'
  el.style.borderRadius = '999px'
  el.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.15), 0 1px 1px rgba(0, 0, 0, 0.08)'
  el.style.whiteSpace = 'nowrap'
  el.style.fontFamily = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
  return el
}

function makeTooltipPopup(text: string): maplibregl.Popup {
  return new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    offset: 14,
    className: 'trip-route-via-tooltip',
  }).setText(text)
}

export default function TripRouteMap({ from, to, routeEdge, stations, className }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const { unitSystem } = useUnitSystem()
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

    let rafId: number | null = null
    const trackedMarkers: maplibregl.Marker[] = []
    const trackedPopups: maplibregl.Popup[] = []

    const onLoad = () => {
      const decoded = routeEdge ? decodePolyline(routeEdge.polyline) : null
      const lineCoords: Array<[number, number]> = decoded && decoded.length >= 2
        ? decoded
        : [[from.lon, from.lat], [to.lon, to.lat]]

      const reduceMotion = prefersReducedMotion()
      const cumulative = buildCumulative(lineCoords)
      const initialCoords = reduceMotion
        ? lineCoords
        : coordsUpToFraction(lineCoords, cumulative.cumulative, cumulative.total, 0.001)

      map.addSource('trip-route', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: initialCoords } },
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

      // Endpoint pins
      const originMarker = new maplibregl.Marker({ element: makePinElement('origin'), anchor: 'bottom' })
        .setLngLat([from.lon, from.lat])
        .addTo(map)
      trackedMarkers.push(originMarker)
      const destMarker = new maplibregl.Marker({ element: makePinElement('destination'), anchor: 'bottom' })
        .setLngLat([to.lon, to.lat])
        .addTo(map)
      trackedMarkers.push(destMarker)

      // Via pins with hover/tap tooltips
      if (routeEdge) {
        for (const viaId of routeEdge.via_station_ids) {
          if (viaId === from.station_id || viaId === to.station_id) continue
          const via = stationById.get(viaId)
          if (!via) continue
          const el = makePinElement('via')
          el.setAttribute('role', 'button')
          el.setAttribute('tabindex', '0')
          el.setAttribute('aria-label', via.name)
          el.setAttribute('data-via-station-id', via.station_id)
          const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
            .setLngLat([via.lon, via.lat])
            .addTo(map)
          trackedMarkers.push(marker)

          const popup = makeTooltipPopup(via.name)
          trackedPopups.push(popup)

          const showTooltip = () => {
            popup.setLngLat([via.lon, via.lat]).addTo(map)
          }
          const hideTooltip = () => {
            popup.remove()
          }

          el.addEventListener('mouseenter', showTooltip)
          el.addEventListener('mouseleave', hideTooltip)
          el.addEventListener('focus', showTooltip)
          el.addEventListener('blur', hideTooltip)
          // Touch / tap-to-toggle. We swallow the synthetic click so it doesn't
          // also trigger the mouseenter path on touch devices.
          el.addEventListener('click', (e) => {
            e.stopPropagation()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((popup as any).isOpen?.()) hideTooltip()
            else showTooltip()
          })
        }
      }

      // Distance label overlay near the polyline midpoint.
      if (routeEdge) {
        const mid = midpointWithPerpendicular(lineCoords)
        if (mid) {
          // Offset perpendicular to the local line direction by a small amount
          // in degrees. ~10px at typical zoom maps to ~0.00008 deg lat; we use
          // a fixed degree-space nudge here because the marker re-anchors as
          // the map zooms and panning keeps the pill aligned with the line.
          const NUDGE_DEG = 0.00015
          const lng = mid.lng + mid.perp[0] * NUDGE_DEG
          const lat = mid.lat + mid.perp[1] * NUDGE_DEG
          const labelText = `${formatDistance(routeEdge.meters, unitSystem)} · ${formatMinutes(routeEdge.seconds)}`
          const labelEl = makeDistanceLabelElement(labelText)
          const labelMarker = new maplibregl.Marker({ element: labelEl, anchor: 'center' })
            .setLngLat([lng, lat])
            .addTo(map)
          trackedMarkers.push(labelMarker)
        }
      }

      const bounds = new maplibregl.LngLatBounds()
      for (const c of lineCoords) bounds.extend(c)
      map.fitBounds(bounds, { padding: 40, duration: 0 })

      // Polyline draw-in animation. Runs once per (re)mount of this effect,
      // which is keyed on the route prop tuple — same route stays static.
      if (!reduceMotion && lineCoords.length >= 2 && cumulative.total > 0) {
        const start = performance.now()
        const ease = (t: number) => 1 - Math.pow(1 - t, 3) // ease-out cubic
        const step = (now: number) => {
          const elapsed = now - start
          const t = Math.min(1, elapsed / DRAW_ANIMATION_MS)
          const f = ease(t)
          const next = coordsUpToFraction(lineCoords, cumulative.cumulative, cumulative.total, f)
          const source = map.getSource('trip-route') as maplibregl.GeoJSONSource | undefined
          if (source && typeof source.setData === 'function') {
            source.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: next } })
          }
          if (t < 1) {
            rafId = requestAnimationFrame(step)
          } else {
            rafId = null
          }
        }
        rafId = requestAnimationFrame(step)
      }
    }

    map.on('load', onLoad)

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      for (const p of trackedPopups) p.remove()
      for (const m of trackedMarkers) m.remove()
      map.off('load', onLoad)
      map.remove()
      mapRef.current = null
    }
  }, [from, to, routeEdge, stationById, unitSystem])

  return <div ref={containerRef} className={className} aria-label="Bike route map" />
}
