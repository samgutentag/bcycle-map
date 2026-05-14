import { useState } from 'react'

type Row = { snapshot_ts: number; bikes: number; docks: number }
type Props = {
  data: Row[]
  /** Total dock capacity for this station — used as y-axis max so the chart shape is meaningful. */
  totalDocks?: number
  /** Which series to render. Defaults to 'both' (stacked). */
  show?: 'bikes' | 'docks' | 'both'
  /** When set, draws a "linked" vertical guide at this unix timestamp (seconds). */
  externalGuideTimeSec?: number | null
  /** Optional label shown above the external guide (e.g. "leave 8:00"). */
  externalGuideLabel?: string
  /** Called with the hovered bucket's start timestamp (seconds), or null when not hovered. */
  onHoverTimeChange?: (ts: number | null) => void
}

const WIDTH = 600
const HEIGHT = 230
const PAD_L = 36
const PAD_R = 12
const PAD_T = 28   // room for hover tooltip text at top
const PAD_B = 38   // room for hour + date labels at bottom
const BUCKET_SEC = 30 * 60  // half-hour buckets

const BIKES_COLOR = '#0d6cb0'
const DOCKS_COLOR = '#15803d'
const GRID_COLOR = '#e5e7eb'
const TICK_COLOR = '#9ca3af'
const MAJOR_LABEL_COLOR = '#6b7280'
const TOOLTIP_BG = '#1f2937'
const TOOLTIP_FG = '#ffffff'
const EXTERNAL_GUIDE_COLOR = '#d97706'  // amber-600 — distinguishes from in-chart hover guide
const EXTERNAL_GUIDE_FG = '#ffffff'

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

type Tick = { ts: number; major: boolean; label: string; dateLabel?: string }

function hourLabel(h: number): string {
  if (h === 0) return '12a'
  if (h === 12) return '12p'
  return h < 12 ? `${h}a` : `${h - 12}p`
}

function hourTicks(xMin: number, xMax: number): Tick[] {
  if (xMin >= xMax) return []
  const span = xMax - xMin
  const majorEveryHours = span <= 36 * 3600 ? 1 : span <= 7 * 86400 ? 3 : 12
  const minorEveryHours = span <= 36 * 3600 ? 0.5 : span <= 7 * 86400 ? 1 : 6

  const ticks: Tick[] = []
  const minorStepSec = minorEveryHours * 3600
  const firstMinor = Math.ceil(xMin / minorStepSec) * minorStepSec
  for (let ts = firstMinor; ts <= xMax; ts += minorStepSec) {
    const d = new Date(ts * 1000)
    const h = d.getHours()
    const isHourly = ts % 3600 === 0
    const isMajor = isHourly && h % majorEveryHours === 0
    const label = isMajor ? hourLabel(h) : ''
    const dateLabel = isMajor && h === 0
      ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : undefined
    ticks.push({ ts, major: isMajor, label, dateLabel })
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

function formatTooltipTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export default function StationOverTimeChart({
  data,
  totalDocks,
  show = 'both',
  externalGuideTimeSec,
  externalGuideLabel,
  onHoverTimeChange,
}: Props) {
  const showBikes = show === 'bikes' || show === 'both'
  const showDocks = show === 'docks' || show === 'both'
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

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

  // Y max: when stacking both series, the visual ceiling is total dock slots
  // (bikes + docks at any moment ≈ capacity). For single-series modes, the
  // ceiling is the observed max of that one series.
  const observedMax = show === 'both'
    ? Math.max(...buckets.map(b => b.bikes + b.docks))
    : Math.max(...buckets.map(b => (showBikes ? b.bikes : b.docks)))
  const yMax = totalDocks && totalDocks > 0 ? totalDocks : Math.ceil(observedMax)
  const xSpan = Math.max(BUCKET_SEC, xMax - xMin)
  const ySpan = Math.max(1, yMax)

  const scaleX = (t: number) => PAD_L + ((t - xMin) / xSpan) * (WIDTH - PAD_L - PAD_R)
  const scaleY = (v: number) => HEIGHT - PAD_B - (v / ySpan) * (HEIGHT - PAD_T - PAD_B)
  const xBucketWidth = (WIDTH - PAD_L - PAD_R) * (BUCKET_SEC / xSpan)
  const groupGap = 0.15
  const barWidth = Math.max(0.6, xBucketWidth * (1 - groupGap))

  const xTicks = hourTicks(xMin, xMax)
  const yTicks = yAxisTicks(yMax)
  const last = buckets[buckets.length - 1]!
  const hoverBucket = hoverIdx !== null ? buckets[hoverIdx] : null

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

        {/* X hour ticks + adaptive labels */}
        {xTicks.map(t => (
          <g key={`x-${t.ts}`}>
            <line
              x1={scaleX(t.ts)}
              y1={HEIGHT - PAD_B}
              x2={scaleX(t.ts)}
              y2={HEIGHT - PAD_B + (t.major ? 5 : 2)}
              stroke={TICK_COLOR}
              strokeWidth={t.major ? 1 : 0.5}
            />
            {t.major && (
              <text
                x={scaleX(t.ts)}
                y={HEIGHT - PAD_B + 14}
                textAnchor="middle"
                fontSize="9"
                fill={MAJOR_LABEL_COLOR}
              >
                {t.label}
              </text>
            )}
            {t.dateLabel && (
              <text
                x={scaleX(t.ts)}
                y={HEIGHT - PAD_B + 25}
                textAnchor="middle"
                fontSize="9"
                fontWeight="600"
                fill={MAJOR_LABEL_COLOR}
              >
                {t.dateLabel}
              </text>
            )}
            {t.dateLabel && (
              <line
                x1={scaleX(t.ts)}
                y1={PAD_T}
                x2={scaleX(t.ts)}
                y2={HEIGHT - PAD_B}
                stroke="#cbd5e1"
                strokeWidth={0.7}
                strokeDasharray="2 3"
              />
            )}
          </g>
        ))}

        <line x1={PAD_L} y1={HEIGHT - PAD_B} x2={WIDTH - PAD_R} y2={HEIGHT - PAD_B} stroke={GRID_COLOR} strokeWidth={1} />
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={HEIGHT - PAD_B} stroke={GRID_COLOR} strokeWidth={1} />

        {/* Stacked bars (or single bars when filtered to one series) */}
        {buckets.map((b, i) => {
          const xLeft = scaleX(b.bucketTs) + (xBucketWidth - barWidth) / 2
          const isHovered = hoverIdx === i
          const bikesH = (HEIGHT - PAD_B) - scaleY(b.bikes)
          const stackBaseY = scaleY(b.bikes)
          const docksH = stackBaseY - scaleY(b.bikes + b.docks)
          return (
            <g
              key={b.bucketTs}
              onMouseEnter={() => { setHoverIdx(i); onHoverTimeChange?.(b.bucketTs) }}
              onMouseLeave={() => { setHoverIdx(null); onHoverTimeChange?.(null) }}
            >
              {/* Invisible hit area covering the full slot for reliable hover even on thin bars */}
              <rect
                x={scaleX(b.bucketTs)}
                y={PAD_T}
                width={Math.max(2, xBucketWidth)}
                height={HEIGHT - PAD_T - PAD_B}
                fill="transparent"
              />
              {showBikes && (
                <rect
                  x={xLeft}
                  y={stackBaseY}
                  width={barWidth}
                  height={Math.max(0, bikesH)}
                  fill={BIKES_COLOR}
                  opacity={isHovered ? 1 : 0.9}
                />
              )}
              {show === 'both' && showDocks && (
                <rect
                  x={xLeft}
                  y={scaleY(b.bikes + b.docks)}
                  width={barWidth}
                  height={Math.max(0, docksH)}
                  fill={DOCKS_COLOR}
                  opacity={isHovered ? 1 : 0.9}
                />
              )}
              {show === 'docks' && (
                <rect
                  x={xLeft}
                  y={scaleY(b.docks)}
                  width={barWidth}
                  height={Math.max(0, (HEIGHT - PAD_B) - scaleY(b.docks))}
                  fill={DOCKS_COLOR}
                  opacity={isHovered ? 1 : 0.9}
                />
              )}
            </g>
          )
        })}

        {/* External guide — drawn from a sibling chart (e.g. linked route view) */}
        {externalGuideTimeSec != null && externalGuideTimeSec >= xMin && externalGuideTimeSec <= xMax && (() => {
          const gx = scaleX(externalGuideTimeSec)
          const labelWidth = externalGuideLabel ? Math.min(120, externalGuideLabel.length * 6 + 14) : 0
          const labelX = Math.min(WIDTH - PAD_R - labelWidth / 2 - 2, Math.max(PAD_L + labelWidth / 2 + 2, gx))
          return (
            <g pointerEvents="none">
              <line
                x1={gx}
                y1={PAD_T}
                x2={gx}
                y2={HEIGHT - PAD_B}
                stroke={EXTERNAL_GUIDE_COLOR}
                strokeWidth={1.4}
                strokeDasharray="4 2"
                opacity={0.95}
              />
              {externalGuideLabel && (
                <>
                  <rect
                    x={labelX - labelWidth / 2}
                    y={2}
                    width={labelWidth}
                    height={16}
                    rx={3}
                    fill={EXTERNAL_GUIDE_COLOR}
                    opacity={0.95}
                  />
                  <text
                    x={labelX}
                    y={13}
                    textAnchor="middle"
                    fontSize="9"
                    fontWeight="600"
                    fill={EXTERNAL_GUIDE_FG}
                  >
                    {externalGuideLabel}
                  </text>
                </>
              )}
            </g>
          )
        })()}

        {/* Hover tooltip — text at top of chart, anchored to the hovered bucket */}
        {hoverBucket && (() => {
          const tx = Math.min(
            WIDTH - PAD_R - 4,
            Math.max(PAD_L + 4, scaleX(hoverBucket.bucketTs) + xBucketWidth / 2),
          )
          const timeLabel = formatTooltipTime(hoverBucket.bucketTs)
          const valueParts: string[] = []
          if (showBikes) valueParts.push(`${hoverBucket.bikes.toFixed(1)} bikes`)
          if (showDocks) valueParts.push(`${hoverBucket.docks.toFixed(1)} docks`)
          const valueLabel = valueParts.join(' · ')
          return (
            <g pointerEvents="none">
              <line
                x1={scaleX(hoverBucket.bucketTs) + xBucketWidth / 2}
                y1={PAD_T}
                x2={scaleX(hoverBucket.bucketTs) + xBucketWidth / 2}
                y2={HEIGHT - PAD_B}
                stroke={TOOLTIP_BG}
                strokeWidth={0.5}
                strokeDasharray="2 2"
                opacity={0.5}
              />
              <rect
                x={tx - 70}
                y={2}
                width={140}
                height={22}
                rx={3}
                fill={TOOLTIP_BG}
                opacity={0.92}
              />
              <text x={tx} y={11} textAnchor="middle" fontSize="9" fill={TOOLTIP_FG}>{timeLabel}</text>
              <text x={tx} y={21} textAnchor="middle" fontSize="9" fontWeight="600" fill={TOOLTIP_FG}>{valueLabel}</text>
            </g>
          )
        })()}
      </svg>
    </div>
  )
}
