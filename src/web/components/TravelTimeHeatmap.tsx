import { useMemo, useState } from 'react'
import { useAppTheme } from '../theme'
import type { StationSnapshot } from '@shared/types'
import type { TravelMatrix } from '../hooks/useTravelMatrix'

type Props = {
  matrix: TravelMatrix
  stations: StationSnapshot[]
  selectedStartId: string | null
  selectedEndId: string | null
  /** When set, clicking a non-diagonal cell calls this with (fromId, toId). */
  onPickPair?: (fromId: string, toId: string) => void
}

const CELL = 8
const LABEL_PAD = 8
const TOOLTIP_H = 22
// Endpoints flip per theme so the "near zero" cells fade into the surface
// instead of standing out as bright squares.
const PALETTE_LIGHT = {
  low: [255, 247, 237] as [number, number, number],   // amber-50
  high: [180, 83, 9] as [number, number, number],     // amber-700
  diagonal: '#f3f4f6',                                // neutral-100
  missing: '#fafafa',
}
const PALETTE_DARK = {
  low: [42, 36, 30] as [number, number, number],      // warm-near-surface
  high: [251, 146, 60] as [number, number, number],   // orange-400
  diagonal: 'rgb(34, 38, 46)',
  missing: 'rgb(28, 32, 38)',
}

function lerpColor(t: number, dark: boolean): string {
  const { low, high } = dark ? PALETTE_DARK : PALETTE_LIGHT
  const r = Math.round(low[0] + (high[0] - low[0]) * t)
  const g = Math.round(low[1] + (high[1] - low[1]) * t)
  const b = Math.round(low[2] + (high[2] - low[2]) * t)
  return `rgb(${r}, ${g}, ${b})`
}

const METERS_PER_MILE = 1609.344

function formatMiles(meters: number): string {
  const mi = meters / METERS_PER_MILE
  if (mi < 0.1) return `${Math.round(meters / 0.3048)} ft`
  if (mi < 10) return `${mi.toFixed(1)} mi`
  return `${Math.round(mi)} mi`
}

export default function TravelTimeHeatmap({ matrix, stations, selectedStartId, selectedEndId, onPickPair }: Props) {
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null)
  const { resolved } = useAppTheme()
  const dark = resolved === 'dark'
  const palette = dark ? PALETTE_DARK : PALETTE_LIGHT

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
          fill="var(--app-text)"
        >
          {hoverFrom.station_id === hoverTo.station_id
            ? hoverFrom.name
            : hoverEdge
              ? `${hoverFrom.name} → ${hoverTo.name} · ${Math.round(hoverEdge.minutes)} min · ${formatMiles(hoverEdge.meters)}`
              : `${hoverFrom.name} → ${hoverTo.name} · no data`}
        </text>
      )}

      {/* Cells */}
      <g transform={`translate(${LABEL_PAD}, ${TOOLTIP_H + LABEL_PAD})`}>
        {sorted.map((from, row) => sorted.map((to, col) => {
          const isDiagonal = from.station_id === to.station_id
          const edge = isDiagonal ? null : matrix.edges[from.station_id]?.[to.station_id]
          const fill = isDiagonal
            ? palette.diagonal
            : edge
              ? lerpColor((edge.minutes - minMinutes) / Math.max(0.1, maxMinutes - minMinutes), dark)
              : palette.missing
          const clickable = !isDiagonal && Boolean(edge) && Boolean(onPickPair)
          return (
            <rect
              key={`${row}-${col}`}
              x={col * CELL}
              y={row * CELL}
              width={CELL}
              height={CELL}
              fill={fill}
              style={clickable ? { cursor: 'pointer' } : undefined}
              onMouseEnter={() => setHover({ row, col })}
              onMouseLeave={() => setHover(prev => (prev && prev.row === row && prev.col === col ? null : prev))}
              onClick={clickable ? () => onPickPair!(from.station_id, to.station_id) : undefined}
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
