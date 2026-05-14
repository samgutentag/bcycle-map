type Props = {
  loading?: boolean
  minutes?: number | null
  meters?: number | null
}

function formatKm(meters: number): string {
  const km = meters / 1000
  return km < 1
    ? `${meters} m`
    : km < 10
      ? `${km.toFixed(1)} km`
      : `${Math.round(km)} km`
}

export default function TravelTimeBadge({ loading, minutes, meters }: Props) {
  let content: React.ReactNode
  if (loading) {
    content = <span className="text-neutral-500">Estimating bike time…</span>
  } else if (minutes != null && meters != null) {
    content = (
      <>
        <span className="font-medium text-amber-900">
          {minutes < 1 ? '<1' : Math.round(minutes)} min bike ride
        </span>
        <span className="text-amber-700"> · {formatKm(meters)}</span>
      </>
    )
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
