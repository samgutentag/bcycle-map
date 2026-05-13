import { useState } from 'react'
import { useLiveSnapshot } from '../hooks/useLiveSnapshot'
import SystemTotals from '../components/SystemTotals'
import DateRangePicker from '../components/DateRangePicker'
import SystemBikesOverTime from '../components/SystemBikesOverTime'
import HourOfWeekHeatmap from '../components/HourOfWeekHeatmap'
import SpatialDensityMap from '../components/SpatialDensityMap'
import { useTotalBikesOverTime } from '../hooks/useTotalBikesOverTime'
import { useHourOfWeek } from '../hooks/useHourOfWeek'
import { resolveRange, type Preset } from '../lib/date-range'

const SYSTEM_ID = 'bcycle_santabarbara'
const R2_BASE = import.meta.env.VITE_R2_PUBLIC_URL ?? 'https://pub-83059e704dd64536a5166ab289eb42e5.r2.dev'

export default function Explore() {
  const { data: live } = useLiveSnapshot(SYSTEM_ID)
  const [preset, setPreset] = useState<Preset>('24h')
  const range = resolveRange(preset, Math.floor(Date.now() / 1000))

  const totals = useTotalBikesOverTime({ baseUrl: R2_BASE, system: SYSTEM_ID, range })
  const hourly = useHourOfWeek({ baseUrl: R2_BASE, system: SYSTEM_ID, range })

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
        <h3 className="text-sm font-semibold text-neutral-700 mb-2">Total bikes available over time</h3>
        {totals.loading && <div className="p-8 text-center text-neutral-500">Loading…</div>}
        {totals.error && <div className="p-8 text-center text-red-600">{totals.error.message}</div>}
        {totals.data && <SystemBikesOverTime data={totals.data} />}
      </section>

      <section className="mb-8 bg-white rounded-lg shadow-sm border border-neutral-200 p-4">
        <h3 className="text-sm font-semibold text-neutral-700 mb-2">Hour-of-week heatmap</h3>
        {hourly.loading && <div className="p-8 text-center text-neutral-500">Loading…</div>}
        {hourly.error && <div className="p-8 text-center text-red-600">{hourly.error.message}</div>}
        {hourly.data && <HourOfWeekHeatmap data={hourly.data} />}
      </section>

      <section className="mb-8 bg-white rounded-lg shadow-sm border border-neutral-200 p-4">
        <h3 className="text-sm font-semibold text-neutral-700 mb-2">Spatial density (latest snapshot)</h3>
        <SpatialDensityMap baseUrl={R2_BASE} system={SYSTEM_ID} atTs={range.toTs} />
      </section>
    </div>
  )
}
