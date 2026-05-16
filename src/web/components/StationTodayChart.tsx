type SeriesRow = { snapshot_ts: number; bikes: number; docks: number }

type Props = {
  /** Series rows for this station — parquet-sourced, possibly several minutes stale. */
  data: SeriesRow[]
  /** Current live bike count from the polled snapshot (anchors the right edge). */
  liveValue: number | null
  /** Timestamp the live snapshot was taken at, in unix seconds. */
  liveTs: number | null
  /** Total dock capacity for this station, drawn as a dotted ceiling reference. */
  totalDocks: number | undefined
  /** Station timezone (e.g. America/Los_Angeles), used to compute "midnight today". */
  timezone: string | undefined
}

const WIDTH = 600
const HEIGHT = 220
const PAD_L = 40
const PAD_R = 16
const PAD_T = 24
const PAD_B = 28

// Same blue as the existing bikes-available chart, so this slot reads as
// "same metric you saw before, different framing".
const LINE_COLOR = '#0d6cb0'

/**
 * Compute the unix-seconds timestamp of "midnight today" in the given IANA
 * timezone. Uses Intl.DateTimeFormat so cross-tz users still see the station's
 * day. Falls back to browser-local midnight if no timezone is provided.
 */
function midnightTsForTimezone(timezone: string | undefined): number {
  const now = new Date()
  if (!timezone) {
    const local = new Date(now)
    local.setHours(0, 0, 0, 0)
    return Math.floor(local.getTime() / 1000)
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(now)
  const hour = Number(parts.find(p => p.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find(p => p.type === 'minute')?.value ?? 0)
  const second = Number(parts.find(p => p.type === 'second')?.value ?? 0)
  const secondsSinceMidnight = hour * 3600 + minute * 60 + second
  return Math.floor(now.getTime() / 1000) - secondsSinceMidnight
}

function formatHourLabel(tsSec: number, timezone: string | undefined): string {
  return new Date(tsSec * 1000).toLocaleTimeString(undefined, {
    hour: 'numeric',
    timeZone: timezone,
  })
}

export default function StationTodayChart({ data, liveValue, liveTs, totalDocks, timezone }: Props) {
  const midnightTs = midnightTsForTimezone(timezone)
  const nowTs = liveTs ?? Math.floor(Date.now() / 1000)

  // Filter to rows from today, sort ascending. We don't trust upstream order.
  const todays = data.filter(r => r.snapshot_ts >= midnightTs && r.snapshot_ts <= nowTs)
    .slice()
    .sort((a, b) => a.snapshot_ts - b.snapshot_ts)

  // Append a synthetic "now" point with the live value so the chart's right
  // edge literally matches the live tile above it (resolves the "chart says 8,
  // tile says 13" confusion).
  const points: Array<{ ts: number; bikes: number }> = todays.map(r => ({
    ts: r.snapshot_ts,
    bikes: r.bikes,
  }))
  if (liveValue !== null) {
    const last = points[points.length - 1]
    if (!last || nowTs > last.ts) {
      points.push({ ts: nowTs, bikes: liveValue })
    }
  }

  if (points.length < 2) {
    return (
      <div className="relative w-full h-48 rounded-md border border-dashed border-line-strong bg-surface-2 flex items-center justify-center">
        <div className="text-center px-6">
          <div className="text-sm font-medium text-ink">Not enough samples yet today</div>
          <div className="text-xs text-ink-subdued mt-1">
            New snapshots land every two minutes — a chart will appear once we have at least two readings today.
          </div>
        </div>
      </div>
    )
  }

  // X axis: midnight → now, regardless of how many samples landed.
  const xMin = midnightTs
  const xMax = nowTs
  const xSpan = Math.max(60, xMax - xMin)

  const maxBikes = Math.max(...points.map(p => p.bikes), totalDocks ?? 0)
  const yMax = Math.max(1, maxBikes)
  const yMin = 0
  const ySpan = Math.max(1, yMax - yMin)

  const scaleX = (t: number) => PAD_L + ((t - xMin) / xSpan) * (WIDTH - PAD_L - PAD_R)
  const scaleY = (v: number) => HEIGHT - PAD_B - ((v - yMin) / ySpan) * (HEIGHT - PAD_T - PAD_B)

  const polyPoints = points.map(p => `${scaleX(p.ts).toFixed(1)},${scaleY(p.bikes).toFixed(1)}`).join(' ')
  const liveX = scaleX(nowTs)
  const liveY = liveValue !== null ? scaleY(liveValue) : null

  // Hour tick marks every 3 hours starting at midnight.
  const ticks: number[] = []
  for (let h = 0; h <= 24; h += 3) {
    const t = midnightTs + h * 3600
    if (t <= nowTs + 3600) ticks.push(t)
  }

  return (
    <div className="w-full">
      <div className="flex gap-4 text-xs text-ink mb-1 px-1">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-0.5" style={{ backgroundColor: LINE_COLOR }} />
          Bikes available today
          {liveValue !== null && (
            <span className="text-ink-subdued">(now {liveValue}{totalDocks ? ` / ${totalDocks}` : ''})</span>
          )}
        </span>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-auto">
        <text x={PAD_L - 4} y={PAD_T + 4} textAnchor="end" fontSize="11" fill="var(--app-text-subdued)">{yMax}</text>
        <text x={PAD_L - 4} y={HEIGHT - PAD_B + 4} textAnchor="end" fontSize="11" fill="var(--app-text-subdued)">0</text>
        <line x1={PAD_L} y1={HEIGHT - PAD_B} x2={WIDTH - PAD_R} y2={HEIGHT - PAD_B} stroke="var(--app-border)" />
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={HEIGHT - PAD_B} stroke="var(--app-border)" />
        {totalDocks && totalDocks > 0 && (
          <line
            x1={PAD_L}
            y1={scaleY(totalDocks)}
            x2={WIDTH - PAD_R}
            y2={scaleY(totalDocks)}
            stroke="var(--app-border)"
            strokeDasharray="3,3"
            opacity={0.6}
          />
        )}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={scaleX(t)} y1={PAD_T} x2={scaleX(t)} y2={HEIGHT - PAD_B} stroke="var(--app-border)" strokeDasharray="2,3" opacity={0.4} />
            <text x={scaleX(t)} y={HEIGHT - PAD_B + 14} textAnchor="middle" fontSize="10" fill="var(--app-text-subdued)">
              {formatHourLabel(t, timezone)}
            </text>
          </g>
        ))}
        <polyline fill="none" stroke={LINE_COLOR} strokeWidth="2" points={polyPoints} />
        {liveY !== null && (
          <g>
            <circle cx={liveX} cy={liveY} r={4} fill={LINE_COLOR} stroke="var(--app-bg-surface)" strokeWidth="2" />
          </g>
        )}
      </svg>
    </div>
  )
}
