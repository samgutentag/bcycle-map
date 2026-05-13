type Row = { snapshot_ts: number; total_bikes: number }
type Props = { data: Row[] }

const WIDTH = 600
const HEIGHT = 200
const PAD = 32

export default function SystemBikesOverTime({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="relative w-full h-48 rounded-md border border-dashed border-neutral-300 bg-gradient-to-br from-neutral-50 via-white to-neutral-100 flex items-center justify-center">
        <div className="text-center px-6">
          <div className="text-sm font-medium text-neutral-700">Not enough data yet</div>
          <div className="text-xs text-neutral-500 mt-1">Check back soon. New snapshots land every two minutes; parquet seals at the top of each hour.</div>
        </div>
      </div>
    )
  }

  const xs = data.map(d => d.snapshot_ts)
  const ys = data.map(d => d.total_bikes)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const yMin = Math.min(...ys)
  const yMax = Math.max(...ys)
  const xSpan = Math.max(1, xMax - xMin)
  const ySpan = Math.max(1, yMax - yMin)

  const scaleX = (t: number) => PAD + ((t - xMin) / xSpan) * (WIDTH - 2 * PAD)
  const scaleY = (v: number) => HEIGHT - PAD - ((v - yMin) / ySpan) * (HEIGHT - 2 * PAD)

  const points = data.map(d => `${scaleX(d.snapshot_ts).toFixed(1)},${scaleY(d.total_bikes).toFixed(1)}`).join(' ')

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-auto">
      <text x={PAD - 4} y={PAD} textAnchor="end" fontSize="11" fill="#6b7280">{yMax}</text>
      <text x={PAD - 4} y={HEIGHT - PAD + 4} textAnchor="end" fontSize="11" fill="#6b7280">{yMin}</text>
      <line x1={PAD} y1={HEIGHT - PAD} x2={WIDTH - PAD} y2={HEIGHT - PAD} stroke="#e5e7eb" />
      <line x1={PAD} y1={PAD} x2={PAD} y2={HEIGHT - PAD} stroke="#e5e7eb" />
      <polyline fill="none" stroke="#15803d" strokeWidth="2" points={points} />
    </svg>
  )
}
