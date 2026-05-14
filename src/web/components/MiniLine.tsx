type Props = {
  values: number[]
  /** Color of the line + end-cap dot. */
  color: string
  /** Width of the rendered SVG in pixels. */
  width?: number
  height?: number
  /** Index that is currently hovered/highlighted. Renders a vertical guide + emphasized dot. */
  hoverIndex?: number | null
  /** Called as the cursor moves between points (null when leaving the SVG). */
  onHoverIndexChange?: (i: number | null) => void
}

/**
 * Tiny axis-less line chart for displaying a 24-point trend with a dot at
 * the most recent value. Renders a flat line if there's only one value, and
 * an empty SVG (no line, no dot) if there are none.
 *
 * When `onHoverIndexChange` is provided, each value gets an invisible hit
 * slot so a parent can render contextual hover state elsewhere.
 */
export default function MiniLine({
  values,
  color,
  width = 110,
  height = 22,
  hoverIndex = null,
  onHoverIndexChange,
}: Props) {
  if (values.length === 0) {
    return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden />
  }
  const pad = 2
  const innerW = width - 2 * pad
  const innerH = height - 2 * pad
  const max = Math.max(1, ...values)
  const min = Math.min(0, ...values)
  const span = Math.max(1, max - min)
  const scaleX = (i: number) =>
    values.length === 1 ? pad + innerW / 2 : pad + (i / (values.length - 1)) * innerW
  const scaleY = (v: number) => pad + innerH - ((v - min) / span) * innerH

  const points = values.map((v, i) => `${scaleX(i).toFixed(1)},${scaleY(v).toFixed(1)}`).join(' ')
  const lastX = scaleX(values.length - 1)
  const lastY = scaleY(values[values.length - 1]!)
  const slotW = values.length > 0 ? width / values.length : width

  const hoveredX = hoverIndex != null && hoverIndex >= 0 && hoverIndex < values.length ? scaleX(hoverIndex) : null
  const hoveredY = hoverIndex != null && hoverIndex >= 0 && hoverIndex < values.length ? scaleY(values[hoverIndex]!) : null

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-label="24-hour trend">
      <polyline fill="none" stroke={color} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" points={points} opacity={0.85} />
      <circle cx={lastX} cy={lastY} r={2.4} fill={color} />
      {hoveredX !== null && hoveredY !== null && (
        <>
          <line x1={hoveredX} y1={pad} x2={hoveredX} y2={height - pad} stroke={color} strokeWidth={0.8} opacity={0.5} strokeDasharray="2 2" />
          <circle cx={hoveredX} cy={hoveredY} r={3} fill={color} stroke="#ffffff" strokeWidth={1} />
        </>
      )}
      {onHoverIndexChange && values.map((_, i) => (
        <rect
          key={i}
          x={i * slotW}
          y={0}
          width={slotW}
          height={height}
          fill="transparent"
          onMouseEnter={() => onHoverIndexChange(i)}
          onMouseLeave={() => onHoverIndexChange(null)}
        />
      ))}
    </svg>
  )
}
