import { useLiveSnapshot } from '../hooks/useLiveSnapshot'
import SystemTotals from '../components/SystemTotals'

const SYSTEM_ID = 'bcycle_santabarbara'

export default function Explore() {
  const { data } = useLiveSnapshot(SYSTEM_ID)

  return (
    <div className="p-6 max-w-3xl">
      <h2 className="text-2xl font-semibold text-neutral-900">Explore</h2>
      <p className="mt-2 text-sm text-neutral-600">
        Right-now snapshot of the system. Historical analysis arrives in Plan 2 once enough parquet has accumulated to be interesting.
      </p>
      {data && (
        <div className="mt-6">
          <SystemTotals stations={data.stations} variant="inline" />
        </div>
      )}
      <div className="mt-8 text-sm text-neutral-500">
        Planned for Plan 2: Kepler.gl + DuckDB-WASM loading R2 parquet directly in the browser. Heatmaps, time animations, station utilization patterns.
      </div>
    </div>
  )
}
