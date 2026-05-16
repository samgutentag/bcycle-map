import { useState } from 'react'
import { useAppTheme } from '../theme'

export type HeatmapScheme = 'bikes' | 'riders'

type Row = { dow: number; hod: number; value: number; samples: number }

type Props = {
  data: Row[]
  /** What the values represent (drives color + tooltip label). */
  scheme?: HeatmapScheme
  /** Singular noun for the tooltip, e.g. 'bikes' or 'riders'. */
  unit?: string
}

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const CELL = 22
const LABEL_W = 32
const HEADER_H = 16
const TOOLTIP_H = 18      // extra height above the grid for the hover tooltip text
const WIDTH = LABEL_W + CELL * 24
const GRID_TOP = HEADER_H + TOOLTIP_H
const HEIGHT = GRID_TOP + CELL * 7

const TOOLTIP_BG = '#1f2937'
const TOOLTIP_FG = '#ffffff'

type Endpoints = { low: [number, number, number]; high: [number, number, number] }
const SCHEMES_LIGHT: Record<HeatmapScheme, Endpoints> = {
  bikes:  { low: [229, 231, 235], high: [21, 128, 61] },    // neutral-200 → green-700
  riders: { low: [255, 237, 213], high: [194, 65, 12] },    // orange-100 → orange-700
}
// In dark mode, the empty cells need to be close to the surface background, not bright.
const SCHEMES_DARK: Record<HeatmapScheme, Endpoints> = {
  bikes:  { low: [40, 48, 58], high: [34, 197, 94] },       // dim slate → green-500
  riders: { low: [50, 38, 32], high: [251, 146, 60] },      // dim warm → orange-400
}

function colorFor(value: number, min: number, max: number, scheme: HeatmapScheme, dark: boolean): string {
  const palette = dark ? SCHEMES_DARK : SCHEMES_LIGHT
  if (max === min) {
    const [r, g, b] = palette[scheme].low
    return `rgb(${r}, ${g}, ${b})`
  }
  const t = (value - min) / (max - min)
  const { low, high } = palette[scheme]
  const r = Math.round(low[0] + (high[0] - low[0]) * t)
  const g = Math.round(low[1] + (high[1] - low[1]) * t)
  const b = Math.round(low[2] + (high[2] - low[2]) * t)
  return `rgb(${r}, ${g}, ${b})`
}

function formatHour(h: number): string {
  if (h === 0) return '12am'
  if (h === 12) return 'noon'
  return h < 12 ? `${h}am` : `${h - 12}pm`
}

export default function HourOfWeekHeatmap({ data, scheme = 'bikes', unit = 'bikes' }: Props) {
  const [hover, setHover] = useState<{ dow: number; hod: number } | null>(null)
  const { resolved } = useAppTheme()
  const dark = resolved === 'dark'
  const labelFill = 'var(--app-text-subdued)'
  const emptyFill = dark ? 'rgb(40, 48, 58)' : '#f3f4f6'

  if (data.length === 0) {
    return (
      <div className="relative w-full h-40 rounded-md border border-dashed border-line-strong bg-surface-2 flex items-center justify-center">
        <div className="text-center px-6">
          <div className="text-sm font-medium text-ink">Not enough data yet</div>
          <div className="text-xs text-ink-subdued mt-1">Hour-of-week patterns need at least a week of history. Check back soon.</div>
        </div>
      </div>
    )
  }

  const lookup = new Map<string, { value: number; samples: number }>()
  for (const r of data) lookup.set(`${r.dow}-${r.hod}`, { value: r.value, samples: r.samples })
  // Scale across the whole grid (all 168 dow×hod cells), not per row or per
  // column — so cells are comparable across the entire heatmap.
  const values = data.map(d => d.value)
  const min = Math.min(...values)
  const max = Math.max(...values)

  const hoveredCell = hover ? lookup.get(`${hover.dow}-${hover.hod}`) : null
  const tooltipText = hover && hoveredCell
    ? `${DAYS_FULL[hover.dow]} ${formatHour(hover.hod)} — ${hoveredCell.value.toFixed(1)} ${unit} avg (${hoveredCell.samples} samples)`
    : null

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-auto">
      {/* Day labels (rows) — note: shifted down by TOOLTIP_H so we have room for the hover pill */}
      {DAYS_SHORT.map((d, dow) => (
        <text key={d} x={LABEL_W - 6} y={GRID_TOP + dow * CELL + CELL * 0.65} textAnchor="end" fontSize="10" fill={labelFill}>
          {d}
        </text>
      ))}
      {/* Hour labels (columns) */}
      {[0, 6, 12, 18, 23].map(h => (
        <text key={h} x={LABEL_W + h * CELL + CELL / 2} y={GRID_TOP - 4} textAnchor="middle" fontSize="10" fill={labelFill}>
          {h}
        </text>
      ))}

      {/* Heatmap cells */}
      {Array.from({ length: 7 }).map((_, dow) =>
        Array.from({ length: 24 }).map((_, hod) => {
          const v = lookup.get(`${dow}-${hod}`)
          const fill = v === undefined ? emptyFill : colorFor(v.value, min, max, scheme, dark)
          const isHovered = hover?.dow === dow && hover?.hod === hod
          return (
            <rect
              key={`${dow}-${hod}`}
              className="cell"
              x={LABEL_W + hod * CELL}
              y={GRID_TOP + dow * CELL}
              width={CELL - 1}
              height={CELL - 1}
              fill={fill}
              stroke={isHovered ? '#111827' : 'none'}
              strokeWidth={isHovered ? 1 : 0}
              onMouseEnter={() => setHover({ dow, hod })}
              onMouseLeave={() => setHover(null)}
            />
          )
        }),
      )}

      {/* Hover tooltip — dark pill at the top, centered horizontally.
       * Empty (rather than a "hover me" placeholder) when nothing is hovered;
       * the interactive cells themselves invite the gesture. */}
      {tooltipText ? (
        <g pointerEvents="none">
          <rect x={LABEL_W} y={0} width={WIDTH - LABEL_W} height={TOOLTIP_H - 2} rx={3} fill={TOOLTIP_BG} opacity={0.92} />
          <text x={LABEL_W + (WIDTH - LABEL_W) / 2} y={TOOLTIP_H - 6} textAnchor="middle" fontSize="10" fontWeight="600" fill={TOOLTIP_FG}>
            {tooltipText}
          </text>
        </g>
      ) : null}
    </svg>
  )
}
