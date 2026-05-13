export function pctAvailable({ bikes, docks }: { bikes: number; docks: number }): number {
  const total = bikes + docks
  if (total === 0) return 0
  return bikes / total
}

export function markerColor(pct: number): string {
  const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t)
  const hex = (n: number) => n.toString(16).padStart(2, '0')
  const [r1, g1, b1] = [0xb9, 0x1c, 0x1c]
  const [r2, g2, b2] = [0x15, 0x80, 0x3d]
  const r = lerp(r1, r2, pct)
  const g = lerp(g1, g2, pct)
  const b = lerp(b1, b2, pct)
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

export function markerSize(totalDocks: number): number {
  return Math.max(6, Math.min(20, 6 + totalDocks * 0.5))
}
