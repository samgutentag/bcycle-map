type Props = {
  /** Aspect ratio expressed as width / height (defaults to the line chart's 600/220). */
  aspectRatio?: number
  label?: string
}

export default function ChartSkeleton({ aspectRatio = 600 / 220, label = 'Loading…' }: Props) {
  return (
    <div
      className="relative w-full rounded-md overflow-hidden shimmer"
      style={{ aspectRatio: String(aspectRatio) }}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xs text-neutral-500 bg-white/70 px-2 py-0.5 rounded">{label}</span>
      </div>
    </div>
  )
}
