type Row = { snapshot_ts: number; total_bikes: number; total_docks: number }
type Props = { data: Row[] }

const WIDTH = 600
const HEIGHT = 220
const PAD_L = 40
const PAD_R = 16
const PAD_T = 24
const PAD_B = 24

const BIKES_COLOR = '#15803d'   // green-700
const DOCKS_COLOR = '#0369a1'   // sky-700

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
  const bikes = data.map(d => d.total_bikes)
  const docks = data.map(d => d.total_docks)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  // Share a y-axis so both series can be compared directly
  const yMin = Math.min(0, ...bikes, ...docks)
  const yMax = Math.max(...bikes, ...docks)
  const xSpan = Math.max(1, xMax - xMin)
  const ySpan = Math.max(1, yMax - yMin)

  const scaleX = (t: number) => PAD_L + ((t - xMin) / xSpan) * (WIDTH - PAD_L - PAD_R)
  const scaleY = (v: number) => HEIGHT - PAD_B - ((v - yMin) / ySpan) * (HEIGHT - PAD_T - PAD_B)

  const bikesPoints = data.map(d => `${scaleX(d.snapshot_ts).toFixed(1)},${scaleY(d.total_bikes).toFixed(1)}`).join(' ')
  const docksPoints = data.map(d => `${scaleX(d.snapshot_ts).toFixed(1)},${scaleY(d.total_docks).toFixed(1)}`).join(' ')

  const lastBikes = data[data.length - 1]!.total_bikes
  const lastDocks = data[data.length - 1]!.total_docks

  return (
    <div className="w-full">
      <div className="flex gap-4 text-xs text-neutral-700 mb-1 px-1">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-0.5" style={{ backgroundColor: BIKES_COLOR }} />
          Bikes available <span className="text-neutral-500">(latest {lastBikes})</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-0.5" style={{ backgroundColor: DOCKS_COLOR }} />
          Open docks <span className="text-neutral-500">(latest {lastDocks})</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-auto">
        <text x={PAD_L - 4} y={PAD_T + 4} textAnchor="end" fontSize="11" fill="#6b7280">{yMax}</text>
        <text x={PAD_L - 4} y={HEIGHT - PAD_B + 4} textAnchor="end" fontSize="11" fill="#6b7280">{yMin}</text>
        <line x1={PAD_L} y1={HEIGHT - PAD_B} x2={WIDTH - PAD_R} y2={HEIGHT - PAD_B} stroke="#e5e7eb" />
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={HEIGHT - PAD_B} stroke="#e5e7eb" />
        <polyline fill="none" stroke={DOCKS_COLOR} strokeWidth="2" points={docksPoints} />
        <polyline fill="none" stroke={BIKES_COLOR} strokeWidth="2" points={bikesPoints} />
      </svg>
    </div>
  )
}
