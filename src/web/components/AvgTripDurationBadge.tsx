type Props = {
  count: number | null
  meanSec: number | null
}

const MIN_SAMPLE_COUNT = 3

export default function AvgTripDurationBadge({ count, meanSec }: Props) {
  if (count === null || meanSec === null) return null
  if (count < MIN_SAMPLE_COUNT) return null

  const minutes = Math.round(meanSec / 60)

  return (
    <div className="inline-flex flex-col items-start px-3 py-2 rounded border bg-sky-50 border-sky-200 text-sky-900">
      <span className="text-sm font-semibold leading-tight">avg {minutes} min</span>
      <span className="text-[10px] uppercase tracking-wide text-sky-700/70">
        over {count} {count === 1 ? 'trip' : 'trips'}
      </span>
    </div>
  )
}
