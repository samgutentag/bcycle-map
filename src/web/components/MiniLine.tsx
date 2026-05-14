type Props = {
  values: number[]
  /** Color of the line + end-cap dot. */
  color: string
  /** Width of the rendered SVG in pixels. */
  width?: number
  height?: number
}

/**
 * Tiny axis-less line chart for displaying a 24-point trend with a dot at
 * the most recent value. Renders a flat line if there's only one value, and
 * an empty SVG (no line, no dot) if there are none.
 */
export default function MiniLine({ values, color, width = 110, height = 22 }: Props) {
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

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-label="24-hour trend">
      <polyline fill="none" stroke={color} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" points={points} opacity={0.85} />
      <circle cx={lastX} cy={lastY} r={2.4} fill={color} />
    </svg>
  )
}
