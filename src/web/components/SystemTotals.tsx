import { useEffect, useState } from 'react'
import type { HourBikeStats, StationSnapshot } from '@shared/types'
import MiniLine from './MiniLine'
import { formatRelative } from '../lib/relative-time'

type Props = {
  stations: StationSnapshot[]
  /** Running max of sum(num_bikes_available) — approximates fleet size. */
  maxBikesEver?: number
  /** Rolling 24-hour per-hour bikes-available min/max from the poller. */
  recent24h?: HourBikeStats[]
  /** IANA timezone for sparkline hover labels. Falls back to browser local. */
  timezone?: string
  /** Unix seconds of the most recent poll. Drives the "checked Xm ago" badge. */
  snapshotTs?: number
  /** Unix seconds of the most recent system-wide bike count change. Drives "changed Xm ago". */
  lastChangedTs?: number
  variant?: 'overlay' | 'inline'
}

const BIKES_COLOR = '#0d6cb0'
const ACTIVE_COLOR = '#ea580c'

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

function formatHourLabel(hourTsSec: number, tz?: string): string {
  return new Date(hourTsSec * 1000).toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    timeZone: tz,
  })
}

export default function SystemTotals({ stations, maxBikesEver, recent24h, timezone, snapshotTs, lastChangedTs, variant = 'overlay' }: Props) {
  const totals = computeTotals(stations)
  const showBikeMax = typeof maxBikesEver === 'number' && maxBikesEver > 0
  const activeRiders = showBikeMax ? Math.max(0, (maxBikesEver as number) - totals.bikes) : null

  // Tick every 10 seconds to keep the fuzzy "Xm ago" badges fresh without
  // hammering the read API. The data source (snapshotTs / lastChangedTs)
  // updates on its own poll cadence — this is purely for relative-time text.
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 10_000)
    return () => clearInterval(id)
  }, [])

  // Build the two sparkline series from the 24-hour rolling stats
  const sorted = (recent24h ?? []).slice().sort((a, b) => a.hour_ts - b.hour_ts)
  const bikesSeries = sorted.map(h => h.bikes_max)
  const activeSeries = showBikeMax
    ? sorted.map(h => Math.max(0, (maxBikesEver as number) - h.bikes_min))
    : []

  const [hover, setHover] = useState<{ series: 'bikes' | 'active'; index: number } | null>(null)
  const hoveredHour = hover ? sorted[hover.index] : null
  const hoveredBikesVal = hover?.series === 'bikes' && hoveredHour ? bikesSeries[hover.index] : null
  const hoveredActiveVal = hover?.series === 'active' && hoveredHour ? activeSeries[hover.index] : null
  const hoveredLabel = hoveredHour ? formatHourLabel(hoveredHour.hour_ts, timezone) : null

  const wrapperClass = variant === 'overlay'
    ? 'absolute bottom-12 right-4 bg-white/95 backdrop-blur rounded-lg shadow-lg border border-neutral-200 px-4 py-3'
    : 'block bg-white rounded-lg shadow-sm border border-neutral-200 p-4'

  return (
    <div className={`${wrapperClass} text-sm text-neutral-900`}>
      <div className="font-semibold text-[10px] uppercase tracking-wide text-emerald-700 mb-1 flex items-center gap-1.5">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden />
        Right now
      </div>
      <div className="flex gap-6">
        {activeRiders !== null && (
          <div className="min-w-[160px]" title="Bikes not parked at any station — riders out using them right now.">
            <div className="text-xl font-bold leading-tight text-orange-600">{activeRiders}</div>
            <div className="text-xs text-neutral-600 h-4 whitespace-nowrap overflow-hidden">
              {hoveredActiveVal != null
                ? <span className="text-orange-700">peak {hoveredActiveVal} · {hoveredLabel}</span>
                : 'active riders'}
            </div>
            <div className="mt-1">
              <MiniLine
                values={activeSeries}
                color={ACTIVE_COLOR}
                hoverIndex={hover?.series === 'active' ? hover.index : null}
                onHoverIndexChange={i => setHover(i === null ? null : { series: 'active', index: i })}
              />
            </div>
          </div>
        )}
        <div className="min-w-[160px]">
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
          <div className="text-xs text-neutral-600 h-4 whitespace-nowrap overflow-hidden">
            {hoveredBikesVal != null
              ? <span className="text-sky-800">peak {hoveredBikesVal} · {hoveredLabel}</span>
              : 'bikes available'}
          </div>
          <div className="mt-1">
            <MiniLine
              values={bikesSeries}
              color={BIKES_COLOR}
              hoverIndex={hover?.series === 'bikes' ? hover.index : null}
              onHoverIndexChange={i => setHover(i === null ? null : { series: 'bikes', index: i })}
            />
          </div>
        </div>
      </div>
      <div className="mt-2 text-xs text-neutral-500 flex flex-wrap items-center gap-x-3 gap-y-1">
        {snapshotTs != null && (
          <span title={`Last poll: ${new Date(snapshotTs * 1000).toLocaleString(undefined, { timeZone: timezone })}`}>
            checked {formatRelative(snapshotTs, nowSec)}
          </span>
        )}
        {lastChangedTs != null && (
          <span title={`Bike count last changed: ${new Date(lastChangedTs * 1000).toLocaleString(undefined, { timeZone: timezone })}`}>
            changed {formatRelative(lastChangedTs, nowSec)}
          </span>
        )}
        <span className="ml-auto">{totals.stationsOnline} / {stations.length} stations online</span>
      </div>
    </div>
  )
}
