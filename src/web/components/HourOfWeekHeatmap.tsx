export type HeatmapScheme = 'bikes' | 'riders'

type Row = { dow: number; hod: number; value: number; samples: number }

type Props = {
  data: Row[]
  /** What the values represent (drives color + tooltip label). */
  scheme?: HeatmapScheme
  /** Singular noun for the tooltip, e.g. 'bikes' or 'riders'. */
  unit?: string
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const CELL = 22
const LABEL_W = 32
const HEADER_H = 16
const WIDTH = LABEL_W + CELL * 24
const HEIGHT = HEADER_H + CELL * 7

// Endpoints of the gradient (lightest, darkest) per scheme.
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

export default function HourOfWeekHeatmap({ data, scheme = 'bikes', unit = 'bikes' }: Props) {
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

  const lookup = new Map<string, number>()
  for (const r of data) lookup.set(`${r.dow}-${r.hod}`, r.value)
  const values = data.map(d => d.value)
  const min = Math.min(...values)
  const max = Math.max(...values)

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-auto">
      {DAYS.map((d, dow) => (
        <text key={d} x={LABEL_W - 6} y={HEADER_H + dow * CELL + CELL * 0.65} textAnchor="end" fontSize="10" fill="#6b7280">
          {d}
        </text>
      ))}
      {[0, 6, 12, 18, 23].map(h => (
        <text key={h} x={LABEL_W + h * CELL + CELL / 2} y={HEADER_H - 4} textAnchor="middle" fontSize="10" fill="#6b7280">
          {h}
        </text>
      ))}
      {Array.from({ length: 7 }).map((_, dow) =>
        Array.from({ length: 24 }).map((_, hod) => {
          const v = lookup.get(`${dow}-${hod}`)
          const fill = v === undefined ? '#f3f4f6' : colorFor(v, min, max, scheme)
          return (
            <rect
              key={`${dow}-${hod}`}
              className="cell"
              x={LABEL_W + hod * CELL}
              y={HEADER_H + dow * CELL}
              width={CELL - 1}
              height={CELL - 1}
              fill={fill}
            >
              {v !== undefined && (
                <title>{`${DAYS[dow]!} ${hod}:00 — avg ${v.toFixed(1)} ${unit}`}</title>
              )}
            </rect>
          )
        }),
      )}
    </svg>
  )
}
