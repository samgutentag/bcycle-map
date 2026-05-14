type Row = { snapshot_ts: number; bikes: number; docks: number }
type Props = {
  data: Row[]
  /** Total dock capacity for this station — used as y-axis max so the chart shape is meaningful. */
  totalDocks?: number
  /** Which series to render. Defaults to 'both'. */
  show?: 'bikes' | 'docks' | 'both'
}

const WIDTH = 600
const HEIGHT = 220
const PAD_L = 36
const PAD_R = 12
const PAD_T = 12
const PAD_B = 28

const BIKES_COLOR = '#0d6cb0'   // BCycle blue
const DOCKS_COLOR = '#15803d'   // green-700
const GRID_COLOR = '#e5e7eb'
const TICK_COLOR = '#9ca3af'
const MAJOR_LABEL_COLOR = '#6b7280'

/** Major-tick labels at 0/6/12/18 local hours, minor ticks at every other hour. */
function hourTicks(xMin: number, xMax: number): Array<{ ts: number; major: boolean; label: string }> {
  if (xMin >= xMax) return []
  const firstHour = Math.ceil(xMin / 3600) * 3600
  const ticks: Array<{ ts: number; major: boolean; label: string }> = []
  for (let ts = firstHour; ts <= xMax; ts += 3600) {
    const d = new Date(ts * 1000)
    const h = d.getHours()  // local time
    const major = h === 0 || h === 6 || h === 12 || h === 18
    let label = ''
    if (major) {
      label = h === 0 ? '12am' : h === 12 ? 'noon' : h < 12 ? `${h}am` : `${h - 12}pm`
    }
    ticks.push({ ts, major, label })
  }
  return ticks
}

/** Y-axis ticks chosen to give 4-6 intervals of round numbers. */
function yAxisTicks(max: number): number[] {
  if (max <= 0) return [0]
  if (max <= 6) return Array.from({ length: max + 1 }, (_, i) => i)
  const niceSteps = [1, 2, 5, 10, 20, 25, 50, 100]
  const target = max / 5
  let step = niceSteps[niceSteps.length - 1]!
  for (const s of niceSteps) {
    if (s >= target) { step = s; break }
  }
  const ticks: number[] = []
  for (let v = 0; v <= max; v += step) ticks.push(v)
  if (ticks[ticks.length - 1]! < max) ticks.push(max)
  return ticks
}

export default function StationOverTimeChart({ data, totalDocks, show = 'both' }: Props) {
  const showBikes = show === 'bikes' || show === 'both'
  const showDocks = show === 'docks' || show === 'both'
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
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  // Y max: prefer the known station capacity; else fall back to observed max
  const observedMax = Math.max(
    ...data.map(d => {
      const candidates = [d.bikes + d.docks]
      if (showBikes) candidates.push(d.bikes)
      if (showDocks) candidates.push(d.docks)
      return Math.max(...candidates)
    }),
  )
  const yMax = totalDocks && totalDocks > 0 ? totalDocks : observedMax
  const xSpan = Math.max(1, xMax - xMin)
  const ySpan = Math.max(1, yMax)

  const scaleX = (t: number) => PAD_L + ((t - xMin) / xSpan) * (WIDTH - PAD_L - PAD_R)
  const scaleY = (v: number) => HEIGHT - PAD_B - (v / ySpan) * (HEIGHT - PAD_T - PAD_B)

  const bikesPoints = data.map(d => `${scaleX(d.snapshot_ts).toFixed(1)},${scaleY(d.bikes).toFixed(1)}`).join(' ')
  const docksPoints = data.map(d => `${scaleX(d.snapshot_ts).toFixed(1)},${scaleY(d.docks).toFixed(1)}`).join(' ')

  const xTicks = hourTicks(xMin, xMax)
  const yTicks = yAxisTicks(yMax)

  const last = data[data.length - 1]!

  return (
    <div className="w-full">
      <div className="flex gap-4 text-xs text-neutral-700 mb-1 px-1">
        {showBikes && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5" style={{ backgroundColor: BIKES_COLOR }} />
            Bikes available <span className="text-neutral-500">(now {last.bikes})</span>
          </span>
        )}
        {showDocks && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5" style={{ backgroundColor: DOCKS_COLOR }} />
            Open docks <span className="text-neutral-500">(now {last.docks})</span>
          </span>
        )}
        {totalDocks ? <span className="ml-auto text-neutral-500">Total docks: {totalDocks}</span> : null}
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-auto">
        {/* Y-axis grid + ticks + labels */}
        {yTicks.map(v => (
          <g key={`y-${v}`}>
            <line
              x1={PAD_L}
              y1={scaleY(v)}
              x2={WIDTH - PAD_R}
              y2={scaleY(v)}
              stroke={GRID_COLOR}
              strokeWidth={0.5}
            />
            <line x1={PAD_L - 4} y1={scaleY(v)} x2={PAD_L} y2={scaleY(v)} stroke={TICK_COLOR} strokeWidth={1} />
            <text x={PAD_L - 6} y={scaleY(v) + 3} textAnchor="end" fontSize="10" fill={MAJOR_LABEL_COLOR}>
              {v}
            </text>
          </g>
        ))}

        {/* X-axis hour ticks */}
        {xTicks.map(t => (
          <g key={`x-${t.ts}`}>
            <line
              x1={scaleX(t.ts)}
              y1={HEIGHT - PAD_B}
              x2={scaleX(t.ts)}
              y2={HEIGHT - PAD_B + (t.major ? 6 : 3)}
              stroke={TICK_COLOR}
              strokeWidth={t.major ? 1 : 0.5}
            />
            {t.major && (
              <text
                x={scaleX(t.ts)}
                y={HEIGHT - PAD_B + 18}
                textAnchor="middle"
                fontSize="10"
                fill={MAJOR_LABEL_COLOR}
              >
                {t.label}
              </text>
            )}
          </g>
        ))}

        {/* X axis line on top of ticks */}
        <line x1={PAD_L} y1={HEIGHT - PAD_B} x2={WIDTH - PAD_R} y2={HEIGHT - PAD_B} stroke={GRID_COLOR} strokeWidth={1} />
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={HEIGHT - PAD_B} stroke={GRID_COLOR} strokeWidth={1} />

        {/* Data lines */}
        {showDocks && <polyline fill="none" stroke={DOCKS_COLOR} strokeWidth="2" points={docksPoints} />}
        {showBikes && <polyline fill="none" stroke={BIKES_COLOR} strokeWidth="2" points={bikesPoints} />}
      </svg>
    </div>
  )
}
