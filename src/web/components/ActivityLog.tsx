import { useMemo } from 'react'
import type { ActivityLog as ActivityLogData, StationSnapshot, Trip } from '@shared/types'
import { lookupTravelTime, type TravelMatrix } from '../hooks/useTravelMatrix'

type Props = {
  log: ActivityLogData | null
  stations: StationSnapshot[]
  matrix: TravelMatrix | null
  timezone?: string
  /** Max number of events to render in the scroll. */
  maxRows?: number
}

const DEPARTURE_COLOR = 'text-orange-700 bg-orange-50 border-orange-200'
const ARRIVAL_COLOR = 'text-emerald-700 bg-emerald-50 border-emerald-200'

function formatClockTime(tsSec: number, tz?: string): string {
  return new Date(tsSec * 1000).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz,
  })
}

function formatRelative(tsSec: number, nowSec: number): string {
  const diff = nowSec - tsSec
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function tripDurationLabel(trip: Trip): string {
  const m = Math.round(trip.duration_sec / 60)
  return m < 1 ? `<1 min` : `${m} min`
}

function expectedFor(trip: Trip, matrix: TravelMatrix | null): { minutes: number } | null {
  const edge = lookupTravelTime(matrix, trip.from_station_id, trip.to_station_id)
  return edge ? { minutes: Math.round(edge.minutes) } : null
}

export default function ActivityLog({ log, stations, matrix, timezone, maxRows = 30 }: Props) {
  const namesById = useMemo(() => new Map(stations.map(s => [s.station_id, s.name])), [stations])
  const nowSec = Math.floor(Date.now() / 1000)

  if (!log) {
    return <div className="text-sm text-neutral-500">Loading activity…</div>
  }

  const events = [...log.events].slice(-maxRows).reverse()
  const trips = [...log.trips].slice(-10).reverse()

  if (events.length === 0 && trips.length === 0) {
    return (
      <div className="text-sm text-neutral-500 py-4 text-center bg-neutral-50 rounded border border-dashed border-neutral-300">
        No movement observed yet. The poller emits departures and arrivals as bike counts change at any station — watch this space.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-4">
      {/* Recent events column */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500 mb-2">
          Recent departures &amp; arrivals
        </div>
        <ul className="space-y-1 max-h-72 overflow-y-auto pr-1" aria-live="polite">
          {events.map((e, i) => {
            const name = namesById.get(e.station_id) ?? e.station_id
            const isDep = e.type === 'departure'
            return (
              <li key={`${e.ts}-${e.station_id}-${i}`} className="flex items-start gap-2 text-xs">
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded border ${isDep ? DEPARTURE_COLOR : ARRIVAL_COLOR}`}>
                  {isDep ? '↑ out' : '↓ in'}
                  {e.delta > 1 && <span className="ml-1 opacity-70">×{e.delta}</span>}
                </span>
                <span className="flex-1 text-neutral-700 truncate" title={name}>{name}</span>
                <span className="text-neutral-400 whitespace-nowrap" title={formatClockTime(e.ts, timezone)}>
                  {formatRelative(e.ts, nowSec)}
                </span>
              </li>
            )
          })}
        </ul>
      </div>

      {/* Divider */}
      <div className="hidden lg:block w-px bg-neutral-200 self-stretch" aria-hidden />

      {/* Inferred trips column */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500 mb-2">
          Inferred trips
          <span className="ml-1 normal-case text-neutral-400 font-normal">(quiet-period only)</span>
        </div>
        {trips.length === 0 ? (
          <div className="text-xs text-neutral-500 py-2">
            None yet. Trips are paired only when the system transitions cleanly through a single active rider — typically overnight.
          </div>
        ) : (
          <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {trips.map(trip => {
              const fromName = namesById.get(trip.from_station_id) ?? trip.from_station_id
              const toName = namesById.get(trip.to_station_id) ?? trip.to_station_id
              const expected = expectedFor(trip, matrix)
              const actualMin = Math.round(trip.duration_sec / 60)
              const diff = expected ? actualMin - expected.minutes : null
              return (
                <li key={`${trip.departure_ts}-${trip.arrival_ts}`} className="text-xs border border-neutral-200 rounded p-2 bg-neutral-50">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-neutral-700 truncate">{fromName} → {toName}</span>
                    <span className="text-neutral-400 whitespace-nowrap">{formatClockTime(trip.departure_ts, timezone)}</span>
                  </div>
                  <div className="mt-0.5 text-neutral-500">
                    <span className="font-medium text-neutral-700">{tripDurationLabel(trip)}</span>
                    {expected && (
                      <>
                        <span> · expected {expected.minutes} min</span>
                        {diff !== null && diff !== 0 && (
                          <span className={diff > 0 ? 'text-orange-600' : 'text-emerald-700'}>
                            {' '}({diff > 0 ? '+' : ''}{diff})
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
