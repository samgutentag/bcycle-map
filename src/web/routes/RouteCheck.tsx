import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveSnapshot } from '../hooks/useLiveSnapshot'
import { useStationOverTime } from '../hooks/useStationOverTime'
import { useTravelMatrix, lookupTravelTime } from '../hooks/useTravelMatrix'
import DateRangePicker from '../components/DateRangePicker'
import StationPicker from '../components/StationPicker'
import StationOverTimeChart from '../components/StationOverTimeChart'
import TravelTimeBadge from '../components/TravelTimeBadge'
import ChartSkeleton from '../components/ChartSkeleton'
import { resolveRange, type Preset } from '../lib/date-range'

const SYSTEM_ID = 'bcycle_santabarbara'
const API_BASE = import.meta.env.VITE_API_BASE ?? ''
const R2_BASE = import.meta.env.VITE_R2_PUBLIC_URL ?? 'https://pub-83059e704dd64536a5166ab289eb42e5.r2.dev'

type HoverState = { source: 'start' | 'dest'; timeSec: number }

function formatClockTime(tsSec: number): string {
  return new Date(tsSec * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export default function RouteCheck() {
  const { startId, endId } = useParams<{ startId?: string; endId?: string }>()
  const navigate = useNavigate()
  const { data: live } = useLiveSnapshot(SYSTEM_ID)
  const matrix = useTravelMatrix(R2_BASE, SYSTEM_ID)
  const [preset, setPreset] = useState<Preset>('24h')
  const [now] = useState(() => Math.floor(Date.now() / 1000))
  const range = useMemo(() => resolveRange(preset, now), [preset, now])
  const [hover, setHover] = useState<HoverState | null>(null)

  const start = useStationOverTime({
    apiBase: API_BASE,
    r2Base: R2_BASE,
    system: SYSTEM_ID,
    stationId: startId ?? null,
    range,
  })
  const dest = useStationOverTime({
    apiBase: API_BASE,
    r2Base: R2_BASE,
    system: SYSTEM_ID,
    stationId: endId ?? null,
    range,
  })

  function setStart(id: string | null) {
    if (id && endId) navigate(`/route/${id}/${endId}`)
    else if (id) navigate(`/route/${id}`)
    else if (endId) navigate(`/route//${endId}`)
    else navigate('/route')
  }

  function setEnd(id: string | null) {
    if (startId && id) navigate(`/route/${startId}/${id}`)
    else if (id) navigate(`/route//${id}`)
    else if (startId) navigate(`/route/${startId}`)
    else navigate('/route')
  }

  function swapEnds() {
    if (startId && endId) navigate(`/route/${endId}/${startId}`)
    else if (startId) navigate(`/route//${startId}`)
    else if (endId) navigate(`/route/${endId}`)
  }

  const stations = live?.stations ?? []
  const startStation = stations.find(s => s.station_id === startId)
  const destStation = stations.find(s => s.station_id === endId)
  const startTotal = startStation ? startStation.num_bikes_available + startStation.num_docks_available : undefined
  const destTotal = destStation ? destStation.num_bikes_available + destStation.num_docks_available : undefined

  const edge = lookupTravelTime(matrix.data, startId, endId)
  const travelTimeSec = edge ? edge.minutes * 60 : null

  const startExternalGuide = hover?.source === 'dest' && travelTimeSec
    ? hover.timeSec - travelTimeSec
    : null
  const destExternalGuide = hover?.source === 'start' && travelTimeSec
    ? hover.timeSec + travelTimeSec
    : null
  const startGuideLabel = startExternalGuide != null ? `leave ${formatClockTime(startExternalGuide)}` : undefined
  const destGuideLabel = destExternalGuide != null ? `arrive ${formatClockTime(destExternalGuide)}` : undefined

  const handleHover = (source: 'start' | 'dest') => (ts: number | null) => {
    if (ts === null) {
      setHover(prev => (prev?.source === source ? null : prev))
    } else {
      setHover({ source, timeSec: ts })
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h2 className="text-2xl font-semibold text-neutral-900">Route check</h2>
          <p className="text-sm text-neutral-600 mt-1">
            Pick a start and a destination. Hover either chart to see the matching time on the other, offset by your bike-ride duration.
          </p>
        </div>
        <DateRangePicker value={preset} onChange={setPreset} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-end gap-3 mb-6">
        <StationPicker label="Start" value={startId ?? null} stations={stations} onChange={setStart} />
        <button
          type="button"
          onClick={swapEnds}
          disabled={!startId && !endId}
          aria-label="Reverse route (swap start and destination)"
          title="Reverse route"
          className="self-end mb-1 px-3 py-2 rounded-md border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span aria-hidden>⇅</span>
        </button>
        <StationPicker label="Destination" value={endId ?? null} stations={stations} onChange={setEnd} />
      </div>

      <section className="mb-2 bg-white rounded-lg shadow-sm border border-neutral-200 p-4">
        <h3 className="text-sm font-semibold text-neutral-700">
          Start: {startStation?.name ?? <span className="text-neutral-400">(no station selected)</span>}
        </h3>
        <p className="text-xs text-neutral-500 mt-0.5 mb-3">
          Bikes available at the start station over the selected range. Higher line = easier to find one to grab.
        </p>
        {!startId && <div className="text-sm text-neutral-500 py-6">Pick a start station above to see its trends.</div>}
        {startId && start.error && (
          <pre className="p-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded whitespace-pre-wrap select-all">{start.error.message}</pre>
        )}
        {startId && !start.error && (start.loading || !start.data) && (
          <ChartSkeleton aspectRatio={600 / 200} phase={start.phase} />
        )}
        {startId && start.data && !start.loading && (
          <StationOverTimeChart
            data={start.data}
            totalDocks={startTotal}
            show="bikes"
            externalGuideTimeSec={startExternalGuide}
            externalGuideLabel={startGuideLabel}
            onHoverTimeChange={handleHover('start')}
          />
        )}
      </section>

      <TravelTimeBadge
        loading={matrix.loading && !!startId && !!endId}
        minutes={edge?.minutes ?? null}
        meters={edge?.meters ?? null}
      />

      <section className="mb-6 bg-white rounded-lg shadow-sm border border-neutral-200 p-4">
        <h3 className="text-sm font-semibold text-neutral-700">
          Destination: {destStation?.name ?? <span className="text-neutral-400">(no station selected)</span>}
        </h3>
        <p className="text-xs text-neutral-500 mt-0.5 mb-3">
          Open docks at the destination station. Higher line = easier to find a parking spot when you arrive.
        </p>
        {!endId && <div className="text-sm text-neutral-500 py-6">Pick a destination above to see its trends.</div>}
        {endId && dest.error && (
          <pre className="p-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded whitespace-pre-wrap select-all">{dest.error.message}</pre>
        )}
        {endId && !dest.error && (dest.loading || !dest.data) && (
          <ChartSkeleton aspectRatio={600 / 200} phase={dest.phase} />
        )}
        {endId && dest.data && !dest.loading && (
          <StationOverTimeChart
            data={dest.data}
            totalDocks={destTotal}
            show="docks"
            externalGuideTimeSec={destExternalGuide}
            externalGuideLabel={destGuideLabel}
            onHoverTimeChange={handleHover('dest')}
          />
        )}
      </section>

      <p className="text-xs text-neutral-500 mt-2">
        Tip: the URL stays in sync with your selections. Bookmark <code className="bg-neutral-100 px-1 rounded">/route/&lt;start&gt;/&lt;destination&gt;</code> to come back to a specific pair.
      </p>
    </div>
  )
}
