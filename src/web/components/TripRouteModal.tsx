import { useEffect, useMemo } from 'react'
import type { Trip, StationSnapshot } from '@shared/types'
import { lookupRoute, type RouteCache } from '@shared/route-cache'
import { lookupTravelTime, type TravelMatrix } from '../hooks/useTravelMatrix'
import TripRouteMap from './TripRouteMap'

type TripRouteModalProps = {
  trip: Trip
  stations: StationSnapshot[]
  matrix: TravelMatrix | null
  routes: RouteCache | null
  systemTz: string
  onClose: () => void
}

function formatClockTime(tsSec: number, tz: string): string {
  return new Date(tsSec * 1000).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz,
  })
}

function formatDateLine(tsSec: number, tz: string): string {
  return new Date(tsSec * 1000).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: tz,
  })
}

function formatMinutes(seconds: number): string {
  const m = Math.round(seconds / 60)
  return `${m} min`
}

function formatDistance(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`
}

export default function TripRouteModal({ trip, stations, matrix, routes, systemTz, onClose }: TripRouteModalProps) {
  const stationById = useMemo(() => new Map(stations.map(s => [s.station_id, s])), [stations])
  const fromStation = stationById.get(trip.from_station_id)
  const toStation = stationById.get(trip.to_station_id)
  const routeEdge = lookupRoute(routes, trip.from_station_id, trip.to_station_id)
  const matrixEdge = lookupTravelTime(matrix, trip.from_station_id, trip.to_station_id)

  // Lock body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!fromStation || !toStation) {
    // Defensive: parent should not render the modal until stations are loaded.
    return null
  }

  const actualSec = trip.duration_sec
  const typicalSec = matrixEdge ? matrixEdge.minutes * 60 : null
  const distanceMeters = routeEdge?.meters ?? matrixEdge?.meters ?? null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-900/60 backdrop-blur-sm"
      data-testid="trip-route-modal-backdrop"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="trip-route-modal-title"
        className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-4 border-b border-neutral-200">
          <div>
            <h2 id="trip-route-modal-title" className="text-base font-semibold text-neutral-900">
              <span>{fromStation.name}</span>
              <span className="text-neutral-400 mx-1">→</span>
              <span>{toStation.name}</span>
            </h2>
            <p className="text-xs text-neutral-500 mt-1">
              {formatClockTime(trip.departure_ts, systemTz)} → {formatClockTime(trip.arrival_ts, systemTz)}
              <span className="mx-1">·</span>
              {formatDateLine(trip.departure_ts, systemTz)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-neutral-500 hover:text-neutral-900 text-xl leading-none p-1"
          >
            ✕
          </button>
        </div>

        <TripRouteMap
          from={fromStation}
          to={toStation}
          routeEdge={routeEdge}
          stations={stations}
          className="h-72 sm:h-96 w-full bg-neutral-100"
        />

        <div className="p-4 border-t border-neutral-200">
          <dl className="grid grid-cols-3 gap-3 text-center">
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-neutral-500">Actual</dt>
              <dd className="text-sm font-semibold text-neutral-900">{formatMinutes(actualSec)}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-neutral-500">Typical</dt>
              <dd className="text-sm font-semibold text-neutral-900">
                {typicalSec !== null ? formatMinutes(typicalSec) : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-neutral-500">Distance</dt>
              <dd className="text-sm font-semibold text-neutral-900">
                {distanceMeters !== null ? formatDistance(distanceMeters) : '—'}
              </dd>
            </div>
          </dl>
          {!routeEdge && (
            <p className="text-[11px] text-neutral-500 mt-3 text-center">
              Approximate route — bike directions not yet cached for this pair.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
