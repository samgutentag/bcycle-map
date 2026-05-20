// BCycle-style solid teardrop pin with two stacked numbers:
//   top    = bikes available
//   bottom = open docks available

const PIN_FILL = '#0d6cb0'        // BCycle-ish brand blue
const PIN_STROKE = '#0a5896'
const PIN_FILL_OFFLINE = '#9ca3af' // neutral-400 for offline stations
const PIN_STROKE_OFFLINE = '#6b7280'

// Typical-comparison ring colors (#39). Picked to read clearly against both
// Positron and CyclOSM while staying obviously distinct from the offline
// grey treatment. Harmony's `theme.color.status.success/warning` aren't
// available here (this file builds raw SVG strings outside the React tree),
// so we mirror the same hex values Audius Harmony uses.
const RING_SUCCESS = '#16a34a'    // green-600
const RING_WARNING = '#f59e0b'    // amber-500

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

/** Pin-border ring tone for the typical-comparison signal (#39). */
export type PinRingTone = 'success' | 'warning'

export type PinOptions = {
  offline?: boolean
  /**
   * Optional ring around the pin indicating how the current bike count
   * compares to typical for this hour:
   *   - 'success' → above typical (green)
   *   - 'warning' → below typical (amber)
   * Omit for no ring (within epsilon, no baseline, or feature toggled off).
   * The ring is suppressed automatically when `offline` is true so it can't
   * be confused with the grey offline treatment.
   */
  ringTone?: PinRingTone | null
}

export function buildPinSVG(bikesAvailable: number, openDocks: number, opts: PinOptions = {}): string {
  const fill = opts.offline ? PIN_FILL_OFFLINE : PIN_FILL
  const stroke = opts.offline ? PIN_STROKE_OFFLINE : PIN_STROKE
  // Shrink large numbers slightly so they don't overflow the pin body
  const topSize = bikesAvailable >= 100 ? 10 : 12
  const botSize = openDocks >= 100 ? 10 : 12

  // Ring is suppressed on offline pins — those use grey which would already
  // read as a state, and we don't want stacked signals competing.
  const ringColor = !opts.offline && opts.ringTone === 'success' ? RING_SUCCESS
    : !opts.offline && opts.ringTone === 'warning' ? RING_WARNING
    : null
  // Outline path stroke-width is bumped from 1 to 2.25 when a ring is
  // applied. We render the ring as a second copy of the outline path
  // (fill='none', wider stroke) sitting *under* the body so only the
  // border-overhang reads as a colored ring around the teardrop edge.
  const ringSvg = ringColor
    ? `<path d="${PIN_OUTLINE}" fill="none" stroke="${ringColor}" stroke-width="2.5" stroke-linejoin="round"/>`
    : ''

  return `<svg viewBox="0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}" xmlns="http://www.w3.org/2000/svg">` +
    ringSvg +
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

export type EndpointRole = 'origin' | 'destination' | 'via'

const ENDPOINT_COLORS: Record<EndpointRole, { fill: string; stroke: string }> = {
  origin: { fill: '#10b981', stroke: '#047857' },       // emerald
  destination: { fill: '#dc2626', stroke: '#991b1b' },  // red
  via: { fill: '#9ca3af', stroke: '#6b7280' },          // neutral-400
}

/**
 * A simpler endpoint pin for the trip-route modal — no bike/dock numbers.
 * Reuses the teardrop outline. Via pins are smaller and dimmer.
 */
export function buildEndpointPin(role: EndpointRole): string {
  const { fill, stroke } = ENDPOINT_COLORS[role]
  const opacity = role === 'via' ? 0.35 : 1
  return `<svg viewBox="0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}" xmlns="http://www.w3.org/2000/svg" opacity="${opacity}">` +
    `<path d="${PIN_OUTLINE}" fill="${fill}" stroke="${stroke}" stroke-width="1"/>` +
    `<circle cx="${CX}" cy="15" r="4" fill="white"/>` +
    `</svg>`
}
