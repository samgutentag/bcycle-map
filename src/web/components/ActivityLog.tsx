import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ActivityLog as ActivityLogData, StationSnapshot, Trip } from '@shared/types'
import { lookupTravelTime, type TravelMatrix } from '../hooks/useTravelMatrix'
import { useStableVerb } from '../lib/spinner-verbs'

function InferredTripsInfoButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        aria-label="How are inferred trips calculated?"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full border border-line bg-transparent text-[10px] text-ink-subdued hover:text-ink hover:border-line-strong focus:outline-none focus:ring-2 focus:ring-sky-300"
      >
        i
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-900/60 backdrop-blur-sm"
          data-testid="inferred-trips-info-backdrop"
          onClick={() => setOpen(false)}
          onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="inferred-trips-info-title"
            className="bg-surface rounded-lg shadow-xl w-full max-w-sm border border-line p-4 normal-case font-normal tracking-normal"
            css={{ background: 'var(--app-bg-surface)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div id="inferred-trips-info-title" className="text-sm font-semibold text-ink">
                Not directly sourced
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-ink-subdued hover:text-ink text-lg leading-none p-0.5"
              >
                ✕
              </button>
            </div>
            <div className="text-xs text-ink-subdued space-y-2">
              <p>
                GBFS doesn't publish ride events. Trips here are <em>inferred</em> from
                the station-count diff the poller sees every two minutes.
              </p>
              <p>
                When a bike disappears from one station and reappears at another within a
                plausible window, the algorithm pairs them — scored against the travel-time
                matrix so the most likely match wins. Quiet periods (one rider in flight)
                yield unambiguous pairs; busy periods are best-guesses.
              </p>
              <p>
                So: think of these as <em>probable</em> trips, not a tracked ride log.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

type Props = {
  log: ActivityLogData | null
  stations: StationSnapshot[]
  matrix: TravelMatrix | null
  timezone?: string
  /** Max number of events to render. Defaults to 20. */
  maxEvents?: number
  /** Max number of trips to render. Defaults to 20. */
  maxTrips?: number
  /** When set, filter events to this station and trips touching it. */
  stationFilter?: string
  /** When true, drop the column max-height cap so the page can scroll instead of each column. */
  unbounded?: boolean
  /** Fires when a trip row is clicked. The station-name links inside the row do not trigger this. */
  onTripClick?: (trip: Trip) => void
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

export default function ActivityLog({ log, stations, matrix, timezone, maxEvents = 20, maxTrips = 20, stationFilter, unbounded = false, onTripClick }: Props) {
  const columnScrollClass = unbounded ? '' : 'max-h-72 overflow-y-auto pr-1'
  const namesById = useMemo(() => new Map(stations.map(s => [s.station_id, s.name])), [stations])
  // Cross-reference: each event row can look up "is this event the departure
  // or arrival side of an inferred trip?" — if yes, the in/out badge becomes
  // a button that opens the trip modal.
  const tripByEventKey = useMemo(() => {
    const m = new Map<string, Trip>()
    if (!log) return m
    for (const trip of log.trips) {
      m.set(`${trip.departure_ts}|${trip.from_station_id}|departure`, trip)
      m.set(`${trip.arrival_ts}|${trip.to_station_id}|arrival`, trip)
    }
    return m
  }, [log])
  const verb = useStableVerb()
  const nowSec = Math.floor(Date.now() / 1000)

  if (!log) {
    return <div className="text-sm text-ink-subdued">{verb}</div>
  }

  const filteredEventsAll = stationFilter
    ? log.events.filter(e => e.station_id === stationFilter)
    : log.events
  const filteredTripsAll = stationFilter
    ? log.trips.filter(t => t.from_station_id === stationFilter || t.to_station_id === stationFilter)
    : log.trips

  const events = [...filteredEventsAll].slice(-maxEvents).reverse()
  const trips = [...filteredTripsAll].slice(-maxTrips).reverse()

  if (events.length === 0 && trips.length === 0) {
    return (
      <div className="text-sm text-ink-subdued py-4 text-center bg-surface rounded border border-dashed border-line-strong">
        {stationFilter
          ? 'No departures or arrivals captured at this station yet.'
          : 'No movement observed yet. The poller emits departures and arrivals as bike counts change at any station — watch this space.'}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-4">
      {/* Recent events column */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-subdued mb-2">
          {stationFilter ? 'Recent activity at this station' : 'Recent departures & arrivals'}
        </div>
        <ul className={`space-y-1 ${columnScrollClass}`} aria-live="polite">
          {events.map((e, i) => {
            const name = namesById.get(e.station_id) ?? e.station_id
            const isDep = e.type === 'departure'
            const matchingTrip = tripByEventKey.get(`${e.ts}|${e.station_id}|${e.type}`)
            const badgeBase = `inline-flex items-center px-1.5 py-0.5 rounded border ${isDep ? DEPARTURE_COLOR : ARRIVAL_COLOR}`
            const badge = matchingTrip && onTripClick ? (
              <button
                type="button"
                onClick={() => onTripClick(matchingTrip)}
                aria-label={`View inferred trip for this ${e.type}`}
                title="View inferred trip"
                className={`${badgeBase} hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-sky-300 cursor-pointer`}
              >
                {isDep ? '↑ out' : '↓ in'}
                {e.delta > 1 && <span className="ml-1 opacity-70">×{e.delta}</span>}
              </button>
            ) : (
              <span className={badgeBase}>
                {isDep ? '↑ out' : '↓ in'}
                {e.delta > 1 && <span className="ml-1 opacity-70">×{e.delta}</span>}
              </span>
            )
            return (
              <li key={`${e.ts}-${e.station_id}-${i}`} className="flex items-start gap-2 text-xs">
                {badge}
                <Link
                  to={`/station/${e.station_id}/details`}
                  className="flex-1 text-ink truncate hover:text-sky-700 hover:underline"
                  title={name}
                >
                  {name}
                </Link>
                <span className="text-ink-subdued whitespace-nowrap" title={formatClockTime(e.ts, timezone)}>
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
        <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-subdued mb-2 inline-flex items-center">
          {stationFilter ? 'Inferred trips touching this station' : 'Inferred trips'}
          <InferredTripsInfoButton />
        </div>
        {trips.length === 0 ? (
          <div className="text-xs text-ink-subdued py-2">
            None yet. Trips appear here as the poller pairs departures with arrivals; expect more as the day progresses.
          </div>
        ) : (
          <ul className={`space-y-2 ${columnScrollClass}`}>
            {trips.map(trip => {
              const fromName = namesById.get(trip.from_station_id) ?? trip.from_station_id
              const toName = namesById.get(trip.to_station_id) ?? trip.to_station_id
              const expected = expectedFor(trip, matrix)
              const actualMin = Math.round(trip.duration_sec / 60)
              const diff = expected ? actualMin - expected.minutes : null
              const rowLabel = `${fromName} → ${toName}`
              return (
                <li key={`${trip.departure_ts}-${trip.arrival_ts}`}>
                  <button
                    type="button"
                    onClick={() => onTripClick?.(trip)}
                    aria-label={rowLabel}
                    className="w-full text-left text-xs border border-line rounded p-2 bg-surface hover:bg-surface-2 hover:border-line-strong focus:outline-none focus:ring-2 focus:ring-sky-300 transition-colors"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium text-ink truncate">
                        <Link to={`/station/${trip.from_station_id}/details`} onClick={e => e.stopPropagation()} className="hover:text-sky-700 hover:underline">{fromName}</Link>
                        <span className="text-ink-subdued"> → </span>
                        <Link to={`/station/${trip.to_station_id}/details`} onClick={e => e.stopPropagation()} className="hover:text-sky-700 hover:underline">{toName}</Link>
                      </span>
                      <span className="text-ink-subdued whitespace-nowrap">{formatClockTime(trip.departure_ts, timezone)}</span>
                    </div>
                    <div className="mt-0.5 text-ink-subdued">
                      <span className="font-medium text-ink">{tripDurationLabel(trip)}</span>
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
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
