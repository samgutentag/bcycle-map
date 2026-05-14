type Row = { snapshot_ts: number; bikes: number; docks: number }
type Props = { data: Row[] }

const WIDTH = 600
const HEIGHT = 200
const PAD_L = 36
const PAD_R = 12
const PAD_T = 20
const PAD_B = 22

const BIKES_COLOR = '#0d6cb0'
const DOCKS_COLOR = '#15803d'

export default function StationOverTimeChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="relative w-full h-40 rounded-md border border-dashed border-neutral-300 bg-gradient-to-br from-neutral-50 via-white to-neutral-100 flex items-center justify-center">
        <div className="text-center px-6">
          <div className="text-sm font-medium text-neutral-700">No data for this station yet</div>
          <div className="text-xs text-neutral-500 mt-1">Historical samples will populate as the archive fills in.</div>
        </div>
      </div>
    )
  }

  const xs = data.map(d => d.snapshot_ts)
  const bikes = data.map(d => d.bikes)
  const docks = data.map(d => d.docks)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const yMax = Math.max(...bikes, ...docks)
  const yMin = 0
  const xSpan = Math.max(1, xMax - xMin)
  const ySpan = Math.max(1, yMax - yMin)

  const scaleX = (t: number) => PAD_L + ((t - xMin) / xSpan) * (WIDTH - PAD_L - PAD_R)
  const scaleY = (v: number) => HEIGHT - PAD_B - ((v - yMin) / ySpan) * (HEIGHT - PAD_T - PAD_B)

  const bikesPoints = data.map(d => `${scaleX(d.snapshot_ts).toFixed(1)},${scaleY(d.bikes).toFixed(1)}`).join(' ')
  const docksPoints = data.map(d => `${scaleX(d.snapshot_ts).toFixed(1)},${scaleY(d.docks).toFixed(1)}`).join(' ')

  const last = data[data.length - 1]!

  return (
    <div className="w-full">
      <div className="flex gap-4 text-xs text-neutral-700 mb-1 px-1">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-0.5" style={{ backgroundColor: BIKES_COLOR }} />
          Bikes available <span className="text-neutral-500">(now {last.bikes})</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-0.5" style={{ backgroundColor: DOCKS_COLOR }} />
          Open docks <span className="text-neutral-500">(now {last.docks})</span>
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
