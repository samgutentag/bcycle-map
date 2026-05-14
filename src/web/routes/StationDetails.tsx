import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import maplibregl, { Map as MlMap, Marker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useLiveSnapshot } from '../hooks/useLiveSnapshot'
import { useStationOverTime } from '../hooks/useStationOverTime'
import DateRangePicker from '../components/DateRangePicker'
import StationOverTimeChart from '../components/StationOverTimeChart'
import ChartSkeleton from '../components/ChartSkeleton'
import { resolveRange, type Preset } from '../lib/date-range'
import { buildPinSVG, pinSize } from '../lib/pin-svg'
import type { StationSnapshot } from '@shared/types'

const SYSTEM_ID = 'bcycle_santabarbara'
const API_BASE = import.meta.env.VITE_API_BASE ?? ''
const R2_BASE = import.meta.env.VITE_R2_PUBLIC_URL ?? 'https://pub-83059e704dd64536a5166ab289eb42e5.r2.dev'
const POSITRON_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'

type HourBucket = { hour: number; bikes: number; docks: number; samples: number }

type TypicalProfile = {
  stationId: string
  hours: HourBucket[]
  currentHour: number
  currentDow: number
  daysCovered: number
  isDowFiltered: boolean
  label: string
  timezone: string
}

/**
 * Mirror of the popup's sparkline fetcher — same endpoint, just returns the
 * parsed body for use in the right-now-vs-typical callout instead of rendering
 * an SVG into a DOM node.
 */
async function fetchStationTypical(
  apiBase: string,
  systemId: string,
  stationId: string,
): Promise<TypicalProfile> {
  const res = await fetch(
    `${apiBase}/api/systems/${encodeURIComponent(systemId)}/stations/${encodeURIComponent(stationId)}/recent`,
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return await res.json() as TypicalProfile
}

function haversineMiles(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 3958.7613  // Earth radius in miles
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLon = toRad(bLon - aLon)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function formatDistance(miles: number): string {
  if (miles < 0.1) return `${Math.round(miles * 5280)} ft`
  return `${miles.toFixed(1)} mi`
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'} ago`
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60)
    return `${m} minute${m === 1 ? '' : 's'} ago`
  }
  const h = Math.floor(seconds / 3600)
  return `${h} hour${h === 1 ? '' : 's'} ago`
}

function formatHourLabel(h: number): string {
  if (h === 0) return '12am'
  if (h === 12) return 'noon'
  return h < 12 ? `${h}am` : `${h - 12}pm`
}

function formatClockTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * Small non-interactive MapLibre inset rendered at block-level zoom with a
 * single pin matching the live map's pin style. Manages its own map lifecycle.
 */
function MiniMap({ station }: { station: StationSnapshot }) {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const markerRef = useRef<Marker | null>(null)

  useEffect(() => {
    if (!ref.current || mapRef.current) return
    mapRef.current = new maplibregl.Map({
      container: ref.current,
      style: POSITRON_STYLE,
      center: [station.lon, station.lat],
      zoom: 15,
      interactive: false,
      attributionControl: false,
    })
    return () => {
      markerRef.current?.remove()
      markerRef.current = null
      mapRef.current?.remove()
      mapRef.current = null
    }
    // Boot only — re-center handled below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-center + redraw pin when station data changes
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.setCenter([station.lon, station.lat])
    const total = station.num_bikes_available + station.num_docks_available
    const offline = !station.is_installed || !station.is_renting
    const { width, height } = pinSize(total)
    const svg = buildPinSVG(station.num_bikes_available, station.num_docks_available, { offline })

    let marker = markerRef.current
    let el: HTMLElement
    if (marker) {
      el = marker.getElement()
    } else {
      el = document.createElement('div')
      marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([station.lon, station.lat])
        .addTo(map)
      markerRef.current = marker
    }
    el.style.width = `${width}px`
    el.style.height = `${height}px`
    el.innerHTML = svg
  }, [station.lat, station.lon, station.num_bikes_available, station.num_docks_available, station.is_installed, station.is_renting])

  return <div ref={ref} className="w-full h-[200px] rounded-lg overflow-hidden" />
}

type TypicalCalloutProps = {
  stationId: string
  currentBikes: number
}

/**
 * Single-sentence summary of how the current bikes-available compares to the
 * station's typical value for this hour-of-week. Hidden until the API resolves.
 * Shows a "not enough history" placeholder when daysCovered < 3.
 */
function TypicalCallout({ stationId, currentBikes }: TypicalCalloutProps) {
  const [profile, setProfile] = useState<TypicalProfile | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchStationTypical(API_BASE, SYSTEM_ID, stationId).then(
      p => { if (!cancelled) { setProfile(p); setError(null); setLoading(false) } },
      e => { if (!cancelled) { setError(e as Error); setLoading(false) } },
    )
    return () => { cancelled = true }
  }, [stationId])

  if (loading) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-500">
        Comparing to typical…
      </div>
    )
  }
  if (error || !profile) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-500">
        Typical comparison unavailable right now.
      </div>
    )
  }
  if (profile.daysCovered < 3) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
        Not enough history yet — typical comparison will appear after a few days of polling.
      </div>
    )
  }

  const bucket = profile.hours[profile.currentHour]
  const typical = bucket && bucket.samples > 0 ? bucket.bikes : 0
  const hourStr = formatHourLabel(profile.currentHour)
  const dayStr = profile.label
  const typicalStr = typical.toFixed(1)

  let title: string
  let body: string
  let tone: 'more' | 'fewer' | 'avg'

  if (typical <= 0) {
    title = 'No typical baseline yet.'
    body = `${currentBikes} bikes right now. We don't have typical data for ${hourStr} on ${dayStr} yet.`
    tone = 'avg'
  } else if (currentBikes >= typical * 1.5) {
    title = 'More bikes than typical right now.'
    body = `${currentBikes} bikes vs ~${typicalStr} typical for ${hourStr} on ${dayStr}.`
    tone = 'more'
  } else if (currentBikes <= typical * 0.5 || currentBikes <= Math.max(1, typical - 3)) {
    title = 'Fewer bikes than typical right now.'
    body = `${currentBikes} bikes vs ~${typicalStr} typical for ${hourStr} on ${dayStr}.`
    tone = 'fewer'
  } else {
    title = 'About average right now.'
    body = `${currentBikes} bikes (~${typicalStr} typical for ${hourStr} on ${dayStr}).`
    tone = 'avg'
  }

  const toneClass =
    tone === 'more' ? 'border-sky-200 bg-sky-50 text-sky-900'
    : tone === 'fewer' ? 'border-amber-200 bg-amber-50 text-amber-900'
    : 'border-neutral-200 bg-neutral-50 text-neutral-800'

  return (
    <div className={`rounded-lg border p-4 text-sm ${toneClass}`}>
      <span className="font-semibold">{title}</span> {body}
    </div>
  )
}

export default function StationDetails() {
  const { stationId } = useParams<{ stationId: string }>()
  const { data: live, ageSec } = useLiveSnapshot(SYSTEM_ID)
  const [preset, setPreset] = useState<Preset>('24h')
  const [now] = useState(() => Math.floor(Date.now() / 1000))
  const range = useMemo(() => resolveRange(preset, now), [preset, now])

  // Tick every second so the "Reported X seconds ago" line updates without a
  // full re-fetch. useLiveSnapshot already refreshes the underlying data every
  // 60s; this local clock just keeps the relative label fresh.
  const [tick, setTick] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const t = setInterval(() => setTick(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(t)
  }, [])

  const station = live?.stations.find(s => s.station_id === stationId)
  const totalDocks = station ? station.num_bikes_available + station.num_docks_available : undefined
  const offline = station ? !station.is_renting || !station.is_returning || !station.is_installed : false
  const mapsHref = station
    ? `https://www.google.com/maps/search/?api=1&query=${station.lat},${station.lon}`
    : null
  const pctFull = station && totalDocks
    ? Math.round((station.num_bikes_available / totalDocks) * 100)
    : null
  const reportedAge = station ? Math.max(0, tick - station.last_reported) : 0

  const series = useStationOverTime({
    apiBase: API_BASE,
    r2Base: R2_BASE,
    system: SYSTEM_ID,
    stationId: stationId ?? null,
    range,
  })

  // Closest stations by Haversine distance — pulled from the live snapshot so
  // no extra fetch is needed. We take the 5 nearest after excluding self.
  const nearby = useMemo(() => {
    if (!live || !station) return []
    return live.stations
      .filter(s => s.station_id !== station.station_id)
      .map(s => ({ s, miles: haversineMiles(station.lat, station.lon, s.lat, s.lon) }))
      .filter(({ miles }) => Number.isFinite(miles))
      .sort((a, b) => a.miles - b.miles)
      .slice(0, 5)
  }, [live, station])

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-4">
        <Link to="/" className="text-xs text-sky-700 hover:underline">← Back to live map</Link>
      </div>

      {/* Hero: name + address on the left, live stats card on the right */}
      <section className="mb-6 flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-3xl font-semibold text-neutral-900">
              {station?.name ?? <span className="text-neutral-400">Station {stationId}</span>}
            </h2>
            {offline && (
              <span className="px-2 py-0.5 rounded bg-red-100 text-red-800 text-xs font-bold tracking-wide uppercase border border-red-200">
                Station offline
              </span>
            )}
          </div>
          {station?.address && mapsHref && (
            <a
              href={mapsHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-sky-700 hover:underline mt-1 inline-block"
            >
              {station.address} ↗
            </a>
          )}
          {station && (
            <p className="text-xs text-neutral-500 mt-2">
              Reported {formatAge(reportedAge)}
            </p>
          )}
          {!station && live && (
            <p className="text-sm text-neutral-500 mt-2">
              That station isn't in the current snapshot. It may have been recently removed, or the ID is wrong.
            </p>
          )}
        </div>

        {station && (
          <div className="bg-white rounded-lg shadow-sm border border-neutral-200 px-5 py-4 md:min-w-[260px]">
            <div className="font-semibold text-[10px] uppercase tracking-wide text-neutral-500 mb-2">Right now</div>
            <div className="flex gap-6 text-neutral-900">
              <div>
                <div className="text-3xl font-bold leading-none">{station.num_bikes_available}</div>
                <div className="text-xs text-neutral-600 mt-1">bikes available</div>
              </div>
              <div>
                <div className="text-3xl font-bold leading-none">
                  {station.num_docks_available}
                  {totalDocks ? (
                    <span className="text-xl font-normal text-neutral-400"> / {totalDocks}</span>
                  ) : null}
                </div>
                <div className="text-xs text-neutral-600 mt-1">open docks</div>
              </div>
            </div>
            {pctFull !== null && (
              <div className="text-xs text-neutral-500 mt-2">{pctFull}% full</div>
            )}
          </div>
        )}
      </section>

      {/* Mini map inset */}
      {station && (
        <section className="mb-6 bg-white rounded-lg shadow-sm border border-neutral-200 overflow-hidden">
          <MiniMap station={station} />
        </section>
      )}

      {/* Typical patterns chart */}
      <section className="mb-6">
        <div className="flex items-center justify-between gap-4 mb-2">
          <h3 className="text-sm font-semibold text-neutral-700">Typical patterns</h3>
          <DateRangePicker value={preset} onChange={setPreset} />
        </div>
        <p className="text-xs text-neutral-500 mb-3">
          Half-hour averages. Bikes available is in blue; open docks in green. Hover any bar for the exact value.
        </p>
        <div className="bg-white rounded-lg shadow-sm border border-neutral-200 p-4">
          {!stationId && <div className="text-sm text-neutral-500 py-6">No station ID provided.</div>}
          {stationId && series.error && (
            <pre className="p-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded whitespace-pre-wrap select-all">{series.error.message}</pre>
          )}
          {stationId && !series.error && (series.loading || !series.data) && (
            <ChartSkeleton aspectRatio={600 / 230} phase={series.phase} />
          )}
          {stationId && series.data && !series.loading && (
            <StationOverTimeChart data={series.data} totalDocks={totalDocks} show="both" timezone={live?.system.timezone} />
          )}
        </div>
      </section>

      {/* Right-now-vs-typical callout */}
      {station && (
        <section className="mb-6">
          <TypicalCallout stationId={station.station_id} currentBikes={station.num_bikes_available} />
        </section>
      )}

      {/* Nearby stations */}
      {nearby.length > 0 && (
        <section className="mb-6">
          <h3 className="text-sm font-semibold text-neutral-700 mb-2">Nearby stations</h3>
          <div className="bg-white rounded-lg shadow-sm border border-neutral-200 divide-y divide-neutral-100">
            {nearby.map(({ s, miles }) => {
              const total = s.num_bikes_available + s.num_docks_available
              return (
                <div key={s.station_id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-neutral-900 truncate">{s.name}</div>
                    <div className="text-xs text-neutral-500">{formatDistance(miles)} away</div>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-neutral-700 shrink-0">
                    <div className="text-right">
                      <span className="font-semibold text-neutral-900">{s.num_bikes_available}</span>
                      <span className="text-neutral-500"> bikes</span>
                    </div>
                    <div className="text-right">
                      <span className="font-semibold text-neutral-900">{s.num_docks_available}</span>
                      <span className="text-neutral-500">
                        {total > 0 ? ` / ${total}` : ''} docks
                      </span>
                    </div>
                    <Link
                      to={`/station/${encodeURIComponent(s.station_id)}/details`}
                      className="text-sky-700 hover:underline font-medium"
                    >
                      Details →
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="mt-8 pt-4 border-t border-neutral-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-neutral-500">
        <div>
          Tip: bookmark <code className="bg-neutral-100 px-1 rounded">/station/{stationId}/details</code> to come back to this page.
        </div>
        {live && (
          <div>
            Last updated: {formatClockTime(live.snapshot_ts)}
            <span className="text-neutral-400"> ({ageSec < 60 ? `${ageSec}s` : `${Math.floor(ageSec / 60)}m`} ago)</span>
          </div>
        )}
      </footer>
    </div>
  )
}
