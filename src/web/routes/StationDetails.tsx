import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useLiveSnapshot } from '../hooks/useLiveSnapshot'
import { useStationOverTime } from '../hooks/useStationOverTime'
import DateRangePicker from '../components/DateRangePicker'
import StationOverTimeChart from '../components/StationOverTimeChart'
import ChartSkeleton from '../components/ChartSkeleton'
import { resolveRange, type Preset } from '../lib/date-range'

const SYSTEM_ID = 'bcycle_santabarbara'
const API_BASE = import.meta.env.VITE_API_BASE ?? ''
const R2_BASE = import.meta.env.VITE_R2_PUBLIC_URL ?? 'https://pub-83059e704dd64536a5166ab289eb42e5.r2.dev'

export default function StationDetails() {
  const { stationId } = useParams<{ stationId: string }>()
  const { data: live } = useLiveSnapshot(SYSTEM_ID)
  const [preset, setPreset] = useState<Preset>('24h')
  const [now] = useState(() => Math.floor(Date.now() / 1000))
  const range = useMemo(() => resolveRange(preset, now), [preset, now])

  const series = useStationOverTime({
    apiBase: API_BASE,
    r2Base: R2_BASE,
    system: SYSTEM_ID,
    stationId: stationId ?? null,
    range,
  })

  const station = live?.stations.find(s => s.station_id === stationId)
  const totalDocks = station ? station.num_bikes_available + station.num_docks_available : undefined
  const offline = station ? !station.is_renting || !station.is_returning || !station.is_installed : false
  const mapsHref = station
    ? `https://www.google.com/maps/search/?api=1&query=${station.lat},${station.lon}`
    : null

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-4">
        <Link to="/" className="text-xs text-sky-700 hover:underline">← Back to live map</Link>
      </div>

      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-neutral-900">
          {station?.name ?? <span className="text-neutral-400">Station {stationId}</span>}
        </h2>
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
        {!station && live && (
          <p className="text-sm text-neutral-500 mt-2">
            That station isn't in the current snapshot. It may have been recently removed, or the ID is wrong.
          </p>
        )}
      </div>

      {station && (
        <div className="mb-6 bg-white rounded-lg shadow-sm border border-neutral-200 px-4 py-3 inline-block">
          <div className="font-semibold text-[10px] uppercase tracking-wide text-neutral-500 mb-1">Right now</div>
          <div className="flex gap-6 text-sm text-neutral-900">
            <div>
              <div className="text-xl font-bold leading-tight">{station.num_bikes_available}</div>
              <div className="text-xs text-neutral-600">bikes available</div>
            </div>
            <div>
              <div className="text-xl font-bold leading-tight">
                {station.num_docks_available}
                {totalDocks ? (
                  <span className="text-base font-normal text-neutral-400"> / {totalDocks}</span>
                ) : null}
              </div>
              <div className="text-xs text-neutral-600">open docks</div>
            </div>
          </div>
          {offline && <div className="mt-2 text-xs font-medium text-red-700">Station offline</div>}
        </div>
      )}

      <div className="flex items-center justify-between gap-4 mb-2">
        <h3 className="text-sm font-semibold text-neutral-700">Bikes and open docks over time</h3>
        <DateRangePicker value={preset} onChange={setPreset} />
      </div>
      <p className="text-xs text-neutral-500 mb-3">
        Half-hour averages. Bikes available is in blue; open docks in green. Hover any bar for the exact value.
      </p>

      <section className="bg-white rounded-lg shadow-sm border border-neutral-200 p-4">
        {!stationId && <div className="text-sm text-neutral-500 py-6">No station ID provided.</div>}
        {stationId && series.error && (
          <pre className="p-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded whitespace-pre-wrap select-all">{series.error.message}</pre>
        )}
        {stationId && !series.error && (series.loading || !series.data) && (
          <ChartSkeleton aspectRatio={600 / 230} phase={series.phase} />
        )}
        {stationId && series.data && !series.loading && (
          <StationOverTimeChart data={series.data} totalDocks={totalDocks} show="both" />
        )}
      </section>

      <p className="text-xs text-neutral-500 mt-4">
        Tip: bookmark <code className="bg-neutral-100 px-1 rounded">/station/{stationId}/details</code> to come back to this page.
      </p>
    </div>
  )
}
