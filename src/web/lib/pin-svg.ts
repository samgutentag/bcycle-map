const PIE_FULL_BIKES = '#15803d'  // green-700
const PIE_EMPTY = '#9ca3af'       // neutral-400
const PIN_BG = '#ffffff'
const PIN_STROKE = '#1f2937'      // neutral-800

const VIEW_WIDTH = 28
const VIEW_HEIGHT = 36
const ASPECT = VIEW_HEIGHT / VIEW_WIDTH

// Body center at (14, 14), radius 11. Tail tip at (14, 34).
// Tangent points where the body meets the tail are computed once: (4.81, 20.05) and (23.19, 20.05).
const PIN_OUTLINE = 'M 14 34 L 4.81 20.05 A 11 11 0 1 1 23.19 20.05 Z'

// Pie chart geometry inside the round body
const CX = 14
const CY = 14
const R = 8

export function buildPinSVG(bikes: number, docks: number): string {
  const total = bikes + docks
  const ratio = total > 0 ? bikes / total : 0

  let pie: string
  if (ratio === 0) {
    pie = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="${PIE_EMPTY}"/>`
  } else if (ratio === 1) {
    pie = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="${PIE_FULL_BIKES}"/>`
  } else {
    const angle = ratio * 2 * Math.PI
    const x = (CX + R * Math.sin(angle)).toFixed(2)
    const y = (CY - R * Math.cos(angle)).toFixed(2)
    const largeArc = ratio > 0.5 ? 1 : 0
    pie =
      `<circle cx="${CX}" cy="${CY}" r="${R}" fill="${PIE_EMPTY}"/>` +
      `<path d="M ${CX} ${CY} L ${CX} ${CY - R} A ${R} ${R} 0 ${largeArc} 1 ${x} ${y} Z" fill="${PIE_FULL_BIKES}"/>`
  }

  return `<svg viewBox="0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}" xmlns="http://www.w3.org/2000/svg">` +
    `<path d="${PIN_OUTLINE}" fill="${PIN_BG}" stroke="${PIN_STROKE}" stroke-width="1.5"/>` +
    pie +
    `</svg>`
}

export function pinSize(totalCapacity: number): { width: number; height: number } {
  const w = Math.max(24, Math.min(40, 24 + totalCapacity * 0.8))
  return { width: w, height: w * ASPECT }
}
