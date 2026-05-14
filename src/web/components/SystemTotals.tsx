import type { StationSnapshot } from '@shared/types'

type Props = {
  stations: StationSnapshot[]
  /** Running max of sum(num_bikes_available) — approximates fleet size. */
  maxBikesEver?: number
  variant?: 'overlay' | 'inline'
}

export function computeTotals(stations: StationSnapshot[]) {
  const base = stations.reduce(
    (acc, s) => ({
      bikes: acc.bikes + s.num_bikes_available,
      docks: acc.docks + s.num_docks_available,
      stationsOnline: acc.stationsOnline + (s.is_installed && s.is_renting ? 1 : 0),
    }),
    { bikes: 0, docks: 0, stationsOnline: 0 },
  )
  return {
    ...base,
    totalDockSlots: base.bikes + base.docks,
  }
}

export default function SystemTotals({ stations, maxBikesEver, variant = 'overlay' }: Props) {
  const totals = computeTotals(stations)
  const utilization = totals.totalDockSlots > 0
    ? Math.round((totals.bikes / totals.totalDockSlots) * 100)
    : 0
  const showBikeMax = typeof maxBikesEver === 'number' && maxBikesEver > 0
  // Active riders = (fleet size proxy) - (bikes parked right now). Only meaningful
  // once we've observed a peak to compare against.
  const activeRiders = showBikeMax ? Math.max(0, (maxBikesEver as number) - totals.bikes) : null

  const wrapperClass = variant === 'overlay'
    ? 'absolute bottom-4 right-4 bg-white/95 backdrop-blur rounded-lg shadow-lg border border-neutral-200 px-4 py-3'
    : 'inline-block bg-white rounded-lg shadow-sm border border-neutral-200 px-4 py-3'

  return (
    <div className={`${wrapperClass} text-sm text-neutral-900`}>
      <div className="font-semibold text-[10px] uppercase tracking-wide text-neutral-500 mb-1">System totals</div>
      <div className="flex gap-5">
        <div>
          <div className="text-xl font-bold leading-tight">
            {totals.bikes}
            {showBikeMax && (
              <span
                className="text-base font-normal text-neutral-400"
                title="Running max of bikes parked across the system — approximates fleet size."
              >
                {' / '}{maxBikesEver}
              </span>
            )}
          </div>
          <div className="text-xs text-neutral-600">bikes available</div>
        </div>
        {activeRiders !== null && (
          <div title="Bikes not parked at any station — riders out using them right now.">
            <div className="text-xl font-bold leading-tight text-orange-600">{activeRiders}</div>
            <div className="text-xs text-neutral-600">active riders</div>
          </div>
        )}
        <div>
          <div className="text-xl font-bold leading-tight">
            {totals.docks}
            <span
              className="text-base font-normal text-neutral-400"
              title="Total dock slots currently reporting (bikes + open docks)."
            >
              {' / '}{totals.totalDockSlots}
            </span>
          </div>
          <div className="text-xs text-neutral-600">open docks</div>
        </div>
      </div>
      <div className="mt-2 text-xs text-neutral-500">
        {utilization}% full · {totals.stationsOnline} / {stations.length} stations online
      </div>
    </div>
  )
}
