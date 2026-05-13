type Row = { dow: number; hod: number; avg_bikes: number; samples: number }
type Props = { data: Row[] }

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const CELL = 22
const LABEL_W = 32
const HEADER_H = 16
const WIDTH = LABEL_W + CELL * 24
const HEIGHT = HEADER_H + CELL * 7

function colorFor(value: number, min: number, max: number): string {
  if (max === min) return '#e5e7eb'
  const t = (value - min) / (max - min)
  const r = Math.round(229 + (21 - 229) * t)
  const g = Math.round(231 + (128 - 231) * t)
  const b = Math.round(235 + (61 - 235) * t)
  return `rgb(${r}, ${g}, ${b})`
}

export default function HourOfWeekHeatmap({ data }: Props) {
  if (data.length === 0) {
    return <div className="p-8 text-center text-neutral-500">No data for this range.</div>
  }

  const lookup = new Map<string, number>()
  for (const r of data) lookup.set(`${r.dow}-${r.hod}`, r.avg_bikes)
  const values = data.map(d => d.avg_bikes)
  const min = Math.min(...values)
  const max = Math.max(...values)

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-auto">
      {DAYS.map((d, dow) => (
        <text
          key={d}
          x={LABEL_W - 6}
          y={HEADER_H + dow * CELL + CELL * 0.65}
          textAnchor="end"
          fontSize="10"
          fill="#6b7280"
        >
          {d}
        </text>
      ))}
      {[0, 6, 12, 18, 23].map(h => (
        <text
          key={h}
          x={LABEL_W + h * CELL + CELL / 2}
          y={HEADER_H - 4}
          textAnchor="middle"
          fontSize="10"
          fill="#6b7280"
        >
          {h}
        </text>
      ))}
      {Array.from({ length: 7 }).map((_, dow) =>
        Array.from({ length: 24 }).map((_, hod) => {
          const v = lookup.get(`${dow}-${hod}`)
          const fill = v === undefined ? '#f3f4f6' : colorFor(v, min, max)
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
                <title>{`${DAYS[dow]!} ${hod}:00 — avg ${v.toFixed(1)} bikes`}</title>
              )}
            </rect>
          )
        }),
      )}
    </svg>
  )
}
