import { useState } from 'react'

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

const SCHEMES: Record<HeatmapScheme, { light: [number, number, number]; dark: [number, number, number] }> = {
  bikes:  { light: [229, 231, 235], dark: [21, 128, 61] },    // neutral → green-700
  riders: { light: [255, 237, 213], dark: [194, 65, 12] },    // orange-100 → orange-700
}

function colorFor(value: number, min: number, max: number, scheme: HeatmapScheme): string {
  if (max === min) return '#e5e7eb'
  const t = (value - min) / (max - min)
  const { light, dark } = SCHEMES[scheme]
  const r = Math.round(light[0] + (dark[0] - light[0]) * t)
  const g = Math.round(light[1] + (dark[1] - light[1]) * t)
  const b = Math.round(light[2] + (dark[2] - light[2]) * t)
  return `rgb(${r}, ${g}, ${b})`
}

function formatHour(h: number): string {
  if (h === 0) return '12am'
  if (h === 12) return 'noon'
  return h < 12 ? `${h}am` : `${h - 12}pm`
}

export default function HourOfWeekHeatmap({ data, scheme = 'bikes', unit = 'bikes' }: Props) {
  const [hover, setHover] = useState<{ dow: number; hod: number } | null>(null)

  if (data.length === 0) {
    return (
      <div className="relative w-full h-40 rounded-md border border-dashed border-neutral-300 bg-gradient-to-br from-neutral-50 via-white to-neutral-100 flex items-center justify-center">
        <div className="text-center px-6">
          <div className="text-sm font-medium text-neutral-700">Not enough data yet</div>
          <div className="text-xs text-neutral-500 mt-1">Hour-of-week patterns need at least a week of history. Check back soon.</div>
        </div>
      </div>
    )
  }

  const lookup = new Map<string, { value: number; samples: number }>()
  for (const r of data) lookup.set(`${r.dow}-${r.hod}`, { value: r.value, samples: r.samples })
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
        <text key={d} x={LABEL_W - 6} y={GRID_TOP + dow * CELL + CELL * 0.65} textAnchor="end" fontSize="10" fill="#6b7280">
          {d}
        </text>
      ))}
      {/* Hour labels (columns) */}
      {[0, 6, 12, 18, 23].map(h => (
        <text key={h} x={LABEL_W + h * CELL + CELL / 2} y={GRID_TOP - 4} textAnchor="middle" fontSize="10" fill="#6b7280">
          {h}
        </text>
      ))}

      {/* Heatmap cells */}
      {Array.from({ length: 7 }).map((_, dow) =>
        Array.from({ length: 24 }).map((_, hod) => {
          const v = lookup.get(`${dow}-${hod}`)
          const fill = v === undefined ? '#f3f4f6' : colorFor(v.value, min, max, scheme)
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

      {/* Hover tooltip — dark pill at the top, centered horizontally. Falls back to a hint when nothing is hovered. */}
      {tooltipText ? (
        <g pointerEvents="none">
          <rect x={LABEL_W} y={0} width={WIDTH - LABEL_W} height={TOOLTIP_H - 2} rx={3} fill={TOOLTIP_BG} opacity={0.92} />
          <text x={LABEL_W + (WIDTH - LABEL_W) / 2} y={TOOLTIP_H - 6} textAnchor="middle" fontSize="10" fontWeight="600" fill={TOOLTIP_FG}>
            {tooltipText}
          </text>
        </g>
      ) : (
        <text x={LABEL_W + 4} y={TOOLTIP_H - 6} fontSize="9" fill="#9ca3af" fontStyle="italic">
          Hover a cell for details
        </text>
      )}
    </svg>
  )
}
