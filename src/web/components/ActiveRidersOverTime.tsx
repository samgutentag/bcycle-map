type Row = { snapshot_ts: number; total_bikes: number }
type Props = {
  data: Row[]
  /** Running max of system-wide bikes parked. Used as the proxy fleet size. */
  maxBikesEver: number | undefined
}

const WIDTH = 600
const HEIGHT = 220
const PAD_L = 40
const PAD_R = 16
const PAD_T = 24
const PAD_B = 24

// Orange — matches the homepage "active riders" treatment so the
// "live count" semantics carry over to the historical chart.
const ACTIVE_COLOR = '#ea580c' // orange-600

export default function ActiveRidersOverTime({ data, maxBikesEver }: Props) {
  if (!maxBikesEver) {
    return (
      <div className="relative w-full h-48 rounded-md border border-dashed border-line-strong bg-surface-2 flex items-center justify-center">
        <div className="text-center px-6">
          <div className="text-sm font-medium text-ink">Need a fleet-size baseline</div>
          <div className="text-xs text-ink-subdued mt-1">Active riders = (peak observed bikes) − (bikes parked now). The peak count is still being established.</div>
        </div>
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="relative w-full h-48 rounded-md border border-dashed border-line-strong bg-surface-2 flex items-center justify-center">
        <div className="text-center px-6">
          <div className="text-sm font-medium text-ink">Not enough data yet</div>
          <div className="text-xs text-ink-subdued mt-1">Check back soon. New snapshots land every two minutes; parquet seals at the top of each hour.</div>
        </div>
      </div>
    )
  }

  const active = data.map(d => Math.max(0, maxBikesEver - d.total_bikes))
  const xs = data.map(d => d.snapshot_ts)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const yMin = 0
  const yMax = Math.max(1, ...active)
  const xSpan = Math.max(1, xMax - xMin)
  const ySpan = Math.max(1, yMax - yMin)

  const scaleX = (t: number) => PAD_L + ((t - xMin) / xSpan) * (WIDTH - PAD_L - PAD_R)
  const scaleY = (v: number) => HEIGHT - PAD_B - ((v - yMin) / ySpan) * (HEIGHT - PAD_T - PAD_B)

  const points = data.map((d, i) => `${scaleX(d.snapshot_ts).toFixed(1)},${scaleY(active[i]!).toFixed(1)}`).join(' ')
  const lastVal = active[active.length - 1]!
  const peakVal = Math.max(...active)

  // Build "day" tick marks at midnight in the local tz of the data — best-effort, just
  // show 7 evenly spaced day labels across the window.
  const dayTicks: Array<{ x: number; label: string }> = []
  const startDay = new Date(xMin * 1000)
  startDay.setHours(0, 0, 0, 0)
  for (let i = 0; i < 8; i++) {
    const t = startDay.getTime() / 1000 + i * 86400
    if (t < xMin || t > xMax) continue
    dayTicks.push({
      x: scaleX(t),
      label: new Date(t * 1000).toLocaleDateString(undefined, { weekday: 'short' }),
    })
  }

  return (
    <div className="w-full">
      <div className="flex gap-4 text-xs text-ink mb-1 px-1">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-0.5" style={{ backgroundColor: ACTIVE_COLOR }} />
          Active riders <span className="text-ink-subdued">(latest {lastVal} · peak {peakVal})</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-auto">
        <text x={PAD_L - 4} y={PAD_T + 4} textAnchor="end" fontSize="11" fill="var(--app-text-subdued)">{yMax}</text>
        <text x={PAD_L - 4} y={HEIGHT - PAD_B + 4} textAnchor="end" fontSize="11" fill="var(--app-text-subdued)">{yMin}</text>
        <line x1={PAD_L} y1={HEIGHT - PAD_B} x2={WIDTH - PAD_R} y2={HEIGHT - PAD_B} stroke="var(--app-border)" />
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={HEIGHT - PAD_B} stroke="var(--app-border)" />
        {dayTicks.map((t, i) => (
          <g key={i}>
            <line x1={t.x} y1={PAD_T} x2={t.x} y2={HEIGHT - PAD_B} stroke="var(--app-border)" strokeDasharray="2,3" opacity={0.5} />
            <text x={t.x} y={HEIGHT - PAD_B + 14} textAnchor="middle" fontSize="10" fill="var(--app-text-subdued)">{t.label}</text>
          </g>
        ))}
        <polyline fill="none" stroke={ACTIVE_COLOR} strokeWidth="2" points={points} />
      </svg>
    </div>
  )
}
