type Props = {
  loading?: boolean
  minutes?: number | null
  meters?: number | null
  /** When set, the badge prefixes "Leave HH:MM → arrive HH:MM · ..." using this departure time. */
  departureTimeSec?: number | null
  /** IANA timezone for the displayed clock times. Falls back to browser local. */
  timezone?: string
}

const METERS_PER_MILE = 1609.344

function formatMiles(meters: number): string {
  const mi = meters / METERS_PER_MILE
  if (mi < 0.1) return `${Math.round(meters / 0.3048)} ft`
  if (mi < 10) return `${mi.toFixed(1)} mi`
  return `${Math.round(mi)} mi`
}

function formatClockTime(tsSec: number, tz?: string): string {
  return new Date(tsSec * 1000).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz,
  })
}

export default function TravelTimeBadge({ loading, minutes, meters, departureTimeSec, timezone }: Props) {
  let content: React.ReactNode
  if (loading) {
    content = <span className="text-neutral-500">Estimating bike time…</span>
  } else if (minutes != null && meters != null) {
    const minLabel = minutes < 1 ? '<1' : Math.round(minutes)
    const distance = formatMiles(meters)
    if (departureTimeSec != null) {
      const arriveTs = departureTimeSec + minutes * 60
      content = (
        <>
          <span className="font-medium text-amber-900">
            Leave {formatClockTime(departureTimeSec, timezone)} → arrive {formatClockTime(arriveTs, timezone)}
          </span>
          <span className="text-amber-700"> · {minLabel} min · {distance}</span>
        </>
      )
    } else {
      content = (
        <>
          <span className="font-medium text-amber-900">{minLabel} min bike ride</span>
          <span className="text-amber-700"> · {distance}</span>
        </>
      )
    }
  } else {
    content = <span className="text-neutral-500">Travel time unknown</span>
  }

  const baseClass = 'inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border'
  const skinClass = !loading && minutes != null && meters != null
    ? 'bg-amber-50 border-amber-200'
    : 'bg-neutral-50 border-neutral-200'

  return (
    <div className="flex items-center justify-center my-2" aria-label="travel time between selected stations">
      <div className={`${baseClass} ${skinClass}`}>
        <span aria-hidden className="text-neutral-500">↓</span>
        {content}
      </div>
    </div>
  )
}
