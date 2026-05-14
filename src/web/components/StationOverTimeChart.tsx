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
const BUCKET_SEC = 30 * 60  // half-hour buckets

const BIKES_COLOR = '#0d6cb0'
const DOCKS_COLOR = '#15803d'
const GRID_COLOR = '#e5e7eb'
const TICK_COLOR = '#9ca3af'
const MAJOR_LABEL_COLOR = '#6b7280'

type Bucket = { bucketTs: number; bikes: number; docks: number; count: number }

function aggregateBuckets(data: Row[], bucketSec: number): Bucket[] {
  const map = new Map<number, { bikes: number; docks: number; count: number }>()
  for (const d of data) {
    const bucketTs = Math.floor(d.snapshot_ts / bucketSec) * bucketSec
    const cur = map.get(bucketTs) ?? { bikes: 0, docks: 0, count: 0 }
    cur.bikes += d.bikes
    cur.docks += d.docks
    cur.count += 1
    map.set(bucketTs, cur)
  }
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([bucketTs, { bikes, docks, count }]) => ({
      bucketTs,
      bikes: bikes / count,
      docks: docks / count,
      count,
    }))
}

function hourTicks(xMin: number, xMax: number): Array<{ ts: number; major: boolean; label: string }> {
  if (xMin >= xMax) return []
  const firstHour = Math.ceil(xMin / 3600) * 3600
  const ticks: Array<{ ts: number; major: boolean; label: string }> = []
  for (let ts = firstHour; ts <= xMax; ts += 3600) {
    const d = new Date(ts * 1000)
    const h = d.getHours()
    const major = h === 0 || h === 6 || h === 12 || h === 18
    let label = ''
    if (major) {
      label = h === 0 ? '12am' : h === 12 ? 'noon' : h < 12 ? `${h}am` : `${h - 12}pm`
    }
    ticks.push({ ts, major, label })
  }
  return ticks
}

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

  const buckets = aggregateBuckets(data, BUCKET_SEC)
  if (buckets.length === 0) return null

  const xMin = buckets[0]!.bucketTs
  const xMax = buckets[buckets.length - 1]!.bucketTs + BUCKET_SEC
  const observedMax = Math.max(
    ...buckets.map(b => {
      const candidates: number[] = []
      if (showBikes) candidates.push(b.bikes)
      if (showDocks) candidates.push(b.docks)
      return candidates.length ? Math.max(...candidates) : 0
    }),
  )
  const yMax = totalDocks && totalDocks > 0 ? totalDocks : Math.ceil(observedMax)
  const xSpan = Math.max(BUCKET_SEC, xMax - xMin)
  const ySpan = Math.max(1, yMax)

  const scaleX = (t: number) => PAD_L + ((t - xMin) / xSpan) * (WIDTH - PAD_L - PAD_R)
  const scaleY = (v: number) => HEIGHT - PAD_B - (v / ySpan) * (HEIGHT - PAD_T - PAD_B)
  const xBucketWidth = (WIDTH - PAD_L - PAD_R) * (BUCKET_SEC / xSpan)
  const seriesShown = [showBikes, showDocks].filter(Boolean).length
  const innerGap = 1  // px between bars in a group
  const groupGap = 0.15  // fraction of bucket reserved as gap between buckets
  const barWidth = ((xBucketWidth * (1 - groupGap)) - innerGap * (seriesShown - 1)) / Math.max(1, seriesShown)

  const xTicks = hourTicks(xMin, xMax)
  const yTicks = yAxisTicks(yMax)
  const last = buckets[buckets.length - 1]!

  return (
    <div className="w-full">
      <div className="flex gap-4 text-xs text-neutral-700 mb-1 px-1">
        {showBikes && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: BIKES_COLOR }} />
            Bikes available <span className="text-neutral-500">(last 30m avg {last.bikes.toFixed(1)})</span>
          </span>
        )}
        {showDocks && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: DOCKS_COLOR }} />
            Open docks <span className="text-neutral-500">(last 30m avg {last.docks.toFixed(1)})</span>
          </span>
        )}
        {totalDocks ? <span className="ml-auto text-neutral-500">Total docks: {totalDocks}</span> : null}
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-auto">
        {/* Y grid + ticks */}
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

        {/* X hour ticks */}
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

        <line x1={PAD_L} y1={HEIGHT - PAD_B} x2={WIDTH - PAD_R} y2={HEIGHT - PAD_B} stroke={GRID_COLOR} strokeWidth={1} />
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={HEIGHT - PAD_B} stroke={GRID_COLOR} strokeWidth={1} />

        {/* Half-hour average bars */}
        {buckets.map(b => {
          const bucketLeft = scaleX(b.bucketTs) + (xBucketWidth * groupGap) / 2
          let xCursor = bucketLeft
          const elements: JSX.Element[] = []
          if (showBikes) {
            const h = (HEIGHT - PAD_B) - scaleY(b.bikes)
            elements.push(
              <rect
                key={`bikes-${b.bucketTs}`}
                x={xCursor}
                y={scaleY(b.bikes)}
                width={Math.max(0.5, barWidth)}
                height={Math.max(0, h)}
                fill={BIKES_COLOR}
                opacity={0.85}
              >
                <title>{`${new Date(b.bucketTs * 1000).toLocaleString()} — avg ${b.bikes.toFixed(1)} bikes (${b.count} samples)`}</title>
              </rect>,
            )
            xCursor += barWidth + innerGap
          }
          if (showDocks) {
            const h = (HEIGHT - PAD_B) - scaleY(b.docks)
            elements.push(
              <rect
                key={`docks-${b.bucketTs}`}
                x={xCursor}
                y={scaleY(b.docks)}
                width={Math.max(0.5, barWidth)}
                height={Math.max(0, h)}
                fill={DOCKS_COLOR}
                opacity={0.85}
              >
                <title>{`${new Date(b.bucketTs * 1000).toLocaleString()} — avg ${b.docks.toFixed(1)} docks (${b.count} samples)`}</title>
              </rect>,
            )
          }
          return <g key={b.bucketTs}>{elements}</g>
        })}
      </svg>
    </div>
  )
}
