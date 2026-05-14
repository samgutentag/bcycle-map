import { useState } from 'react'
import { useLiveSnapshot } from '../hooks/useLiveSnapshot'
import SystemTotals from '../components/SystemTotals'
import DateRangePicker from '../components/DateRangePicker'
import SystemBikesOverTime from '../components/SystemBikesOverTime'
import HourOfWeekHeatmap from '../components/HourOfWeekHeatmap'
import ChartSkeleton from '../components/ChartSkeleton'
import { useTotalBikesOverTime } from '../hooks/useTotalBikesOverTime'
import { useHourOfWeek } from '../hooks/useHourOfWeek'
import { resolveRange, type Preset } from '../lib/date-range'

const SYSTEM_ID = 'bcycle_santabarbara'
const API_BASE = import.meta.env.VITE_API_BASE ?? ''
const R2_BASE = import.meta.env.VITE_R2_PUBLIC_URL ?? 'https://pub-83059e704dd64536a5166ab289eb42e5.r2.dev'

export default function Explore() {
  const { data: live } = useLiveSnapshot(SYSTEM_ID)
  const [preset, setPreset] = useState<Preset>('24h')
  const range = resolveRange(preset, Math.floor(Date.now() / 1000))

  const totals = useTotalBikesOverTime({ apiBase: API_BASE, r2Base: R2_BASE, system: SYSTEM_ID, range })
  const hourly = useHourOfWeek({ apiBase: API_BASE, r2Base: R2_BASE, system: SYSTEM_ID, range })

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
        <div className="mb-6">
          <SystemTotals stations={live.stations} variant="inline" />
        </div>
      )}

      <section className="mb-8 bg-white rounded-lg shadow-sm border border-neutral-200 p-4">
        <h3 className="text-sm font-semibold text-neutral-700 mb-2">Bikes and open docks over time</h3>
        {totals.error && <pre className="p-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded whitespace-pre-wrap select-all">{totals.error.message}</pre>}
        {!totals.error && (totals.loading || !totals.data) && <ChartSkeleton aspectRatio={600 / 220} />}
        {!totals.loading && !totals.error && totals.data && <SystemBikesOverTime data={totals.data} />}
      </section>

      <section className="mb-8 bg-white rounded-lg shadow-sm border border-neutral-200 p-4">
        <h3 className="text-sm font-semibold text-neutral-700 mb-2">Hour-of-week heatmap</h3>
        {hourly.error && <pre className="p-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded whitespace-pre-wrap select-all">{hourly.error.message}</pre>}
        {!hourly.error && (hourly.loading || !hourly.data) && <ChartSkeleton aspectRatio={(32 + 22 * 24) / (16 + 22 * 7)} />}
        {!hourly.loading && !hourly.error && hourly.data && <HourOfWeekHeatmap data={hourly.data} />}
      </section>

    </div>
  )
}
