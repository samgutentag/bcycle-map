import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveSnapshot } from '../hooks/useLiveSnapshot'
import SystemTotals from '../components/SystemTotals'
import DateRangePicker from '../components/DateRangePicker'
import SystemBikesOverTime from '../components/SystemBikesOverTime'
import HourOfWeekHeatmap from '../components/HourOfWeekHeatmap'
import TravelTimeHeatmap from '../components/TravelTimeHeatmap'
import TravelTimeBadge from '../components/TravelTimeBadge'
import StationPicker from '../components/StationPicker'
import ActivityLog from '../components/ActivityLog'
import ChartSkeleton from '../components/ChartSkeleton'
import { useTotalBikesOverTime } from '../hooks/useTotalBikesOverTime'
import { useHourOfWeek } from '../hooks/useHourOfWeek'
import { useHourOfWeekActiveRiders } from '../hooks/useHourOfWeekActiveRiders'
import { useTravelMatrix, lookupTravelTime } from '../hooks/useTravelMatrix'
import { useActivity } from '../hooks/useActivity'
import { resolveRange, type Preset } from '../lib/date-range'

const SYSTEM_ID = 'bcycle_santabarbara'
const API_BASE = import.meta.env.VITE_API_BASE ?? ''
const R2_BASE = import.meta.env.VITE_R2_PUBLIC_URL ?? 'https://pub-83059e704dd64536a5166ab289eb42e5.r2.dev'

export default function Explore() {
  const navigate = useNavigate()
  const { data: live } = useLiveSnapshot(SYSTEM_ID)
  const matrix = useTravelMatrix(R2_BASE, SYSTEM_ID)
  const activity = useActivity(SYSTEM_ID)
  const [preset, setPreset] = useState<Preset>('24h')
  const [now] = useState(() => Math.floor(Date.now() / 1000))
  const range = useMemo(() => resolveRange(preset, now), [preset, now])
  const [routeStart, setRouteStart] = useState<string | null>(null)
  const [routeEnd, setRouteEnd] = useState<string | null>(null)
  const routeEdge = lookupTravelTime(matrix.data, routeStart, routeEnd)
  const swapRoute = () => {
    setRouteStart(routeEnd)
    setRouteEnd(routeStart)
  }

  const timezone = live?.system.timezone
  const maxBikesEver = live?.max_bikes_ever
  const totals = useTotalBikesOverTime({ apiBase: API_BASE, r2Base: R2_BASE, system: SYSTEM_ID, range })
  const hourly = useHourOfWeek({ apiBase: API_BASE, r2Base: R2_BASE, system: SYSTEM_ID, range, timezone })
  const riders = useHourOfWeekActiveRiders({
    apiBase: API_BASE,
    r2Base: R2_BASE,
    system: SYSTEM_ID,
    range,
    timezone,
    maxBikesEver,
  })

  const bikesHeatmapData = hourly.data?.map(r => ({
    dow: r.dow,
    hod: r.hod,
    value: r.avg_bikes,
    samples: r.samples,
  })) ?? []
  const ridersHeatmapData = riders.data?.map(r => ({
    dow: r.dow,
    hod: r.hod,
    value: r.avg_active_riders,
    samples: r.samples,
  })) ?? []

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h2 className="text-2xl font-semibold text-neutral-900">Explore</h2>
          <p className="text-sm text-neutral-600 mt-1">Historical patterns for the Santa Barbara BCycle system.</p>
        </div>
        <DateRangePicker value={preset} onChange={setPreset} />
      </div>

      {live && (
        <div className="mb-8">
          <SystemTotals stations={live.stations} maxBikesEver={live.max_bikes_ever} recent24h={live.recent24h} timezone={live.system.timezone} snapshotTs={live.snapshot_ts} lastChangedTs={live.last_total_changed_ts} variant="inline" />
        </div>
      )}

      <section className="mb-8 bg-white rounded-lg shadow-sm border border-neutral-200 p-4">
        <h3 className="text-sm font-semibold text-neutral-700">Activity log</h3>
        <p className="text-xs text-neutral-500 mt-0.5 mb-3">
          Recent station-level departures (bike count went down) and arrivals (bike count went up), sampled every two minutes. Inferred trips on the right pair a departure with the next arrival, but only during "quiet periods" where the system has exactly one active rider — so the assumption holds.
        </p>
        {activity.error && <pre className="p-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded whitespace-pre-wrap select-all">{activity.error.message}</pre>}
        {!activity.error && (
          <ActivityLog
            log={activity.data}
            stations={live?.stations ?? []}
            matrix={matrix.data}
            timezone={live?.system.timezone}
          />
        )}
      </section>

      <section className="mb-8 bg-white rounded-lg shadow-sm border border-neutral-200 p-4">
        <h3 className="text-sm font-semibold text-neutral-700">Active riders — hour of week</h3>
        <p className="text-xs text-neutral-500 mt-0.5 mb-3">
          Estimated bikes in use system-wide (max bikes observed minus bikes parked) per day-of-week and hour-of-day. Darker cells = more riders out at that time.
          {!riders.enabled && ' Available once the poller has captured a peak bikes-parked value to compare against.'}
        </p>
        {!riders.enabled && (
          <div className="p-6 text-center text-sm text-neutral-500 bg-neutral-50 rounded border border-dashed border-neutral-300">
            Waiting for a peak bikes-parked observation (usually a 3am idle moment).
          </div>
        )}
        {riders.enabled && riders.error && <pre className="p-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded whitespace-pre-wrap select-all">{riders.error.message}</pre>}
        {riders.enabled && !riders.error && (riders.loading || !riders.data) && <ChartSkeleton aspectRatio={(32 + 22 * 24) / (16 + 22 * 7)} phase={riders.phase} />}
        {riders.enabled && !riders.loading && !riders.error && riders.data && (
          <HourOfWeekHeatmap data={ridersHeatmapData} scheme="riders" unit="riders" />
        )}
      </section>

      <section className="mb-8 bg-white rounded-lg shadow-sm border border-neutral-200 p-4">
        <h3 className="text-sm font-semibold text-neutral-700">Available bikes — hour of week</h3>
        <p className="text-xs text-neutral-500 mt-0.5 mb-3">
          Average bikes parked across the system, broken down by day-of-week (rows) and hour-of-day (columns{timezone ? `, ${timezone}` : ''}). Darker cells mean more bikes parked; lighter cells mean bikes are out being ridden.
        </p>
        {hourly.error && <pre className="p-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded whitespace-pre-wrap select-all">{hourly.error.message}</pre>}
        {!hourly.error && (hourly.loading || !hourly.data) && <ChartSkeleton aspectRatio={(32 + 22 * 24) / (16 + 22 * 7)} phase={hourly.phase} />}
        {!hourly.loading && !hourly.error && hourly.data && (
          <HourOfWeekHeatmap data={bikesHeatmapData} scheme="bikes" unit="bikes" />
        )}
      </section>

      <section className="mb-8 bg-white rounded-lg shadow-sm border border-neutral-200 p-4">
        <h3 className="text-sm font-semibold text-neutral-700">Bikes and open docks over time</h3>
        <p className="text-xs text-neutral-500 mt-0.5 mb-3">
          Totals summed across every station, sampled every two minutes. Bikes + open docks at any moment ≈ total docks in service.
        </p>
        {totals.error && <pre className="p-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded whitespace-pre-wrap select-all">{totals.error.message}</pre>}
        {!totals.error && (totals.loading || !totals.data) && <ChartSkeleton aspectRatio={600 / 220} phase={totals.phase} />}
        {!totals.loading && !totals.error && totals.data && <SystemBikesOverTime data={totals.data} />}
      </section>

      <section className="mb-8 bg-white rounded-lg shadow-sm border border-neutral-200 p-4">
        <h3 className="text-sm font-semibold text-neutral-700">Travel-time matrix</h3>
        <p className="text-xs text-neutral-500 mt-0.5 mb-3">
          Bike-route minutes between every pair of stations, via Google Distance Matrix. Pick an origin and a destination to outline the row and column — they cross at the travel time for that pair. Darker cells = longer rides.
        </p>
        {matrix.error && <pre className="p-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded whitespace-pre-wrap select-all">{matrix.error.message}</pre>}
        {!matrix.error && matrix.loading && <ChartSkeleton aspectRatio={1} />}
        {!matrix.error && !matrix.loading && matrix.data && live && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-end gap-3 mb-3">
              <StationPicker label="Origin" value={routeStart} stations={live.stations} onChange={setRouteStart} />
              <button
                type="button"
                onClick={swapRoute}
                disabled={!routeStart && !routeEnd}
                aria-label="Reverse route (swap origin and destination)"
                title="Reverse route"
                className="self-end mb-1 px-3 py-2 rounded-md border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span aria-hidden>⇅</span>
              </button>
              <StationPicker label="Destination" value={routeEnd} stations={live.stations} onChange={setRouteEnd} />
            </div>
            {(routeStart || routeEnd) && (
              <TravelTimeBadge minutes={routeEdge?.minutes ?? null} meters={routeEdge?.meters ?? null} />
            )}
            <TravelTimeHeatmap
              matrix={matrix.data}
              stations={live.stations}
              selectedStartId={routeStart}
              selectedEndId={routeEnd}
              onPickPair={(fromId, toId) => navigate(`/route/${fromId}/${toId}`)}
            />
            <p className="text-xs text-neutral-500 mt-2">Click any cell to open that pair in the route planner.</p>
          </>
        )}
      </section>

    </div>
  )
}
