import { useMemo, useState } from 'react'
import type { StationSnapshot } from '@shared/types'
import type { TravelMatrix } from '../hooks/useTravelMatrix'

type Props = {
  matrix: TravelMatrix
  stations: StationSnapshot[]
  selectedStartId: string | null
  selectedEndId: string | null
}

const CELL = 8
const LABEL_PAD = 8
const TOOLTIP_H = 22
const COLOR_LIGHT: [number, number, number] = [255, 247, 237]  // amber-50
const COLOR_DARK: [number, number, number] = [180, 83, 9]      // amber-700
const DIAGONAL_COLOR = '#f3f4f6'  // neutral-100
const MISSING_COLOR = '#fafafa'   // even paler — pair not in matrix

function lerpColor(t: number): string {
  const r = Math.round(COLOR_LIGHT[0] + (COLOR_DARK[0] - COLOR_LIGHT[0]) * t)
  const g = Math.round(COLOR_LIGHT[1] + (COLOR_DARK[1] - COLOR_LIGHT[1]) * t)
  const b = Math.round(COLOR_LIGHT[2] + (COLOR_DARK[2] - COLOR_LIGHT[2]) * t)
  return `rgb(${r}, ${g}, ${b})`
}

function formatKm(meters: number): string {
  const km = meters / 1000
  return km < 1
    ? `${meters} m`
    : km < 10
      ? `${km.toFixed(1)} km`
      : `${Math.round(km)} km`
}

export default function TravelTimeHeatmap({ matrix, stations, selectedStartId, selectedEndId }: Props) {
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null)

  // Sort alphabetically by station name to match StationPicker's ordering.
  // Filter to only stations that exist in the matrix so the diagonal stays diagonal.
  const sorted = useMemo(() => {
    const byId = new Map(stations.map(s => [s.station_id, s]))
    return matrix.stations
      .map(ms => byId.get(ms.id))
      .filter((s): s is StationSnapshot => Boolean(s))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [matrix, stations])

  const idToIdx = useMemo(() => {
    const m = new Map<string, number>()
    sorted.forEach((s, i) => m.set(s.station_id, i))
    return m
  }, [sorted])

  // Min/max of edge minutes, for the color scale.
  const { minMinutes, maxMinutes } = useMemo(() => {
    let min = Infinity
    let max = 0
    for (const fromMap of Object.values(matrix.edges)) {
      for (const e of Object.values(fromMap)) {
        if (e.minutes < min) min = e.minutes
        if (e.minutes > max) max = e.minutes
      }
    }
    return { minMinutes: isFinite(min) ? min : 0, maxMinutes: max || 1 }
  }, [matrix])

  const n = sorted.length
  if (n === 0) {
    return (
      <div className="text-sm text-neutral-500 p-4">Travel-time matrix has no overlapping stations with the live snapshot yet.</div>
    )
  }

  const gridWidth = CELL * n
  const gridHeight = CELL * n
  const svgWidth = gridWidth + LABEL_PAD * 2
  const svgHeight = gridHeight + TOOLTIP_H + LABEL_PAD * 2

  const startIdx = selectedStartId ? idToIdx.get(selectedStartId) ?? null : null
  const destIdx = selectedEndId ? idToIdx.get(selectedEndId) ?? null : null

  const hoverFrom = hover ? sorted[hover.row] : null
  const hoverTo = hover ? sorted[hover.col] : null
  const hoverEdge = hoverFrom && hoverTo && hoverFrom.station_id !== hoverTo.station_id
    ? matrix.edges[hoverFrom.station_id]?.[hoverTo.station_id] ?? null
    : null

  return (
    <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-auto select-none" role="img" aria-label="Travel time matrix heatmap">
      {/* Hover tooltip text — pinned at the top */}
      {hoverFrom && hoverTo && (
        <text
          x={svgWidth / 2}
          y={TOOLTIP_H - 6}
          textAnchor="middle"
          fontSize="11"
          fill="#374151"
        >
          {hoverFrom.station_id === hoverTo.station_id
            ? hoverFrom.name
            : hoverEdge
              ? `${hoverFrom.name} → ${hoverTo.name} · ${Math.round(hoverEdge.minutes)} min · ${formatKm(hoverEdge.meters)}`
              : `${hoverFrom.name} → ${hoverTo.name} · no data`}
        </text>
      )}

      {/* Cells */}
      <g transform={`translate(${LABEL_PAD}, ${TOOLTIP_H + LABEL_PAD})`}>
        {sorted.map((from, row) => sorted.map((to, col) => {
          const isDiagonal = from.station_id === to.station_id
          const edge = isDiagonal ? null : matrix.edges[from.station_id]?.[to.station_id]
          const fill = isDiagonal
            ? DIAGONAL_COLOR
            : edge
              ? lerpColor((edge.minutes - minMinutes) / Math.max(0.1, maxMinutes - minMinutes))
              : MISSING_COLOR
          return (
            <rect
              key={`${row}-${col}`}
              x={col * CELL}
              y={row * CELL}
              width={CELL}
              height={CELL}
              fill={fill}
              onMouseEnter={() => setHover({ row, col })}
              onMouseLeave={() => setHover(prev => (prev && prev.row === row && prev.col === col ? null : prev))}
            />
          )
        }))}

        {/* Selected origin row outline */}
        {startIdx !== null && (
          <rect
            x={-0.5}
            y={startIdx * CELL - 0.5}
            width={gridWidth + 1}
            height={CELL + 1}
            fill="none"
            stroke="#dc2626"  /* red-600 */
            strokeWidth={1.5}
            pointerEvents="none"
          />
        )}

        {/* Selected destination column outline */}
        {destIdx !== null && (
          <rect
            x={destIdx * CELL - 0.5}
            y={-0.5}
            width={CELL + 1}
            height={gridHeight + 1}
            fill="none"
            stroke="#dc2626"
            strokeWidth={1.5}
            pointerEvents="none"
          />
        )}

        {/* Intersection cell: stronger outline */}
        {startIdx !== null && destIdx !== null && startIdx !== destIdx && (
          <rect
            x={destIdx * CELL - 1}
            y={startIdx * CELL - 1}
            width={CELL + 2}
            height={CELL + 2}
            fill="none"
            stroke="#7c2d12"  /* amber-900 */
            strokeWidth={2}
            pointerEvents="none"
          />
        )}
      </g>
    </svg>
  )
}
