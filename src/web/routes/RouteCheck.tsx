import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveSnapshot } from '../hooks/useLiveSnapshot'
import { useStationOverTime } from '../hooks/useStationOverTime'
import DateRangePicker from '../components/DateRangePicker'
import StationPicker from '../components/StationPicker'
import StationOverTimeChart from '../components/StationOverTimeChart'
import ChartSkeleton from '../components/ChartSkeleton'
import { resolveRange, type Preset } from '../lib/date-range'

const SYSTEM_ID = 'bcycle_santabarbara'
const API_BASE = import.meta.env.VITE_API_BASE ?? ''
const R2_BASE = import.meta.env.VITE_R2_PUBLIC_URL ?? 'https://pub-83059e704dd64536a5166ab289eb42e5.r2.dev'

export default function RouteCheck() {
  const { startId, endId } = useParams<{ startId?: string; endId?: string }>()
  const navigate = useNavigate()
  const { data: live } = useLiveSnapshot(SYSTEM_ID)
  const [preset, setPreset] = useState<Preset>('24h')
  const [now] = useState(() => Math.floor(Date.now() / 1000))
  const range = useMemo(() => resolveRange(preset, now), [preset, now])

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

  const stations = live?.stations ?? []
  const startStation = stations.find(s => s.station_id === startId)
  const destStation = stations.find(s => s.station_id === endId)

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h2 className="text-2xl font-semibold text-neutral-900">Route check</h2>
          <p className="text-sm text-neutral-600 mt-1">
            Pick a start and a destination. Historical patterns at each station help you predict whether you'll find a bike there or an open dock to park.
          </p>
        </div>
        <DateRangePicker value={preset} onChange={setPreset} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <StationPicker label="Start" value={startId ?? null} stations={stations} onChange={setStart} />
        <StationPicker label="Destination" value={endId ?? null} stations={stations} onChange={setEnd} />
      </div>

      <section className="mb-6 bg-white rounded-lg shadow-sm border border-neutral-200 p-4">
        <h3 className="text-sm font-semibold text-neutral-700">
          Start: {startStation?.name ?? <span className="text-neutral-400">(no station selected)</span>}
        </h3>
        <p className="text-xs text-neutral-500 mt-0.5 mb-3">
          Bikes available and open docks at the start station over the selected range. Higher bikes line = easier to find one to grab.
        </p>
        {!startId && <div className="text-sm text-neutral-500 py-6">Pick a start station above to see its trends.</div>}
        {startId && start.error && (
          <pre className="p-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded whitespace-pre-wrap select-all">{start.error.message}</pre>
        )}
        {startId && !start.error && (start.loading || !start.data) && (
          <ChartSkeleton aspectRatio={600 / 200} phase={start.phase} />
        )}
        {startId && start.data && !start.loading && <StationOverTimeChart data={start.data} />}
      </section>

      <section className="mb-6 bg-white rounded-lg shadow-sm border border-neutral-200 p-4">
        <h3 className="text-sm font-semibold text-neutral-700">
          Destination: {destStation?.name ?? <span className="text-neutral-400">(no station selected)</span>}
        </h3>
        <p className="text-xs text-neutral-500 mt-0.5 mb-3">
          Bikes available and open docks at the destination station. Higher docks line = easier to find a parking spot when you arrive.
        </p>
        {!endId && <div className="text-sm text-neutral-500 py-6">Pick a destination above to see its trends.</div>}
        {endId && dest.error && (
          <pre className="p-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded whitespace-pre-wrap select-all">{dest.error.message}</pre>
        )}
        {endId && !dest.error && (dest.loading || !dest.data) && (
          <ChartSkeleton aspectRatio={600 / 200} phase={dest.phase} />
        )}
        {endId && dest.data && !dest.loading && <StationOverTimeChart data={dest.data} />}
      </section>

      <p className="text-xs text-neutral-500 mt-2">
        Tip: the URL stays in sync with your selections. Bookmark <code className="bg-neutral-100 px-1 rounded">/route/&lt;start&gt;/&lt;destination&gt;</code> to come back to a specific pair.
      </p>
    </div>
  )
}
