// BCycle-style solid teardrop pin with two stacked numbers:
//   top    = bikes available
//   bottom = open docks available

const PIN_FILL = '#0d6cb0'        // BCycle-ish brand blue
const PIN_STROKE = '#0a5896'
const PIN_FILL_OFFLINE = '#9ca3af' // neutral-400 for offline stations
const PIN_STROKE_OFFLINE = '#6b7280'

const VIEW_WIDTH = 36
const VIEW_HEIGHT = 48
const ASPECT = VIEW_HEIGHT / VIEW_WIDTH

// Teardrop outline: round body radius 13 centered at (18,15), tail tip at (18,47).
// Tangent points computed once (precision good to 2 decimals) so the path is
// deterministic and inspectable.
const PIN_OUTLINE = 'M 18 47 L 6.13 23.0 A 13 13 0 1 1 29.87 23.0 Z'

const CX = 18
const TOP_Y = 16    // bikes-available baseline
const SEP_Y = 20    // horizontal rule between numbers
const BOT_Y = 30    // open-docks baseline

export type PinOptions = {
  offline?: boolean
}

export function buildPinSVG(bikesAvailable: number, openDocks: number, opts: PinOptions = {}): string {
  const fill = opts.offline ? PIN_FILL_OFFLINE : PIN_FILL
  const stroke = opts.offline ? PIN_STROKE_OFFLINE : PIN_STROKE
  // Shrink large numbers slightly so they don't overflow the pin body
  const topSize = bikesAvailable >= 100 ? 10 : 12
  const botSize = openDocks >= 100 ? 10 : 12

  return `<svg viewBox="0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}" xmlns="http://www.w3.org/2000/svg">` +
    `<path d="${PIN_OUTLINE}" fill="${fill}" stroke="${stroke}" stroke-width="1"/>` +
    `<text x="${CX}" y="${TOP_Y}" text-anchor="middle" font-size="${topSize}" font-weight="700" font-family="system-ui,-apple-system,sans-serif" fill="white">${bikesAvailable}</text>` +
    `<line x1="8" y1="${SEP_Y}" x2="28" y2="${SEP_Y}" stroke="white" stroke-opacity="0.7" stroke-width="1" stroke-linecap="round"/>` +
    `<text x="${CX}" y="${BOT_Y}" text-anchor="middle" font-size="${botSize}" font-weight="700" font-family="system-ui,-apple-system,sans-serif" fill="white">${openDocks}</text>` +
    `</svg>`
}

export function pinSize(totalCapacity: number): { width: number; height: number } {
  // Subtle size scale: 30–42 px wide. Most stations land at ~33-36.
  const w = Math.max(30, Math.min(42, 30 + totalCapacity * 0.4))
  return { width: w, height: w * ASPECT }
}
