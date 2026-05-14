type HourBucket = { hour: number; bikes: number; docks: number; samples: number }

type TypicalResponse = {
  stationId: string
  hours: HourBucket[]
  currentHour: number
  currentDow: number
  daysCovered: number
  isDowFiltered: boolean
  label: string
  timezone: string
}

const SVG_W = 220
const SVG_H = 44
const PAD = 2

const HIST_COLOR = '#0d6cb0'   // historical typical — BCycle blue
const LIVE_COLOR = '#ea580c'   // live now — orange-600
const EMPTY_COLOR = '#e5e7eb'  // no-data ghost
const BASELINE_COLOR = '#d1d5db'

/**
 * Fetches the station's typical 24-hour profile (DOW-specific once 21+ days
 * of data exist, else all-days fallback) and renders bars + a live overlay
 * at the current hour. No-op if the container detaches before the fetch
 * resolves.
 */
export async function renderSparkline(
  container: HTMLElement,
  apiBase: string,
  systemId: string,
  stationId: string,
  currentBikes: number,
): Promise<void> {
  container.innerHTML = `
    <div class="text-xs text-neutral-400 italic mb-1">Loading…</div>
    <div class="block" data-spark-svg></div>
  `
  try {
    const res = await fetch(
      `${apiBase}/api/systems/${encodeURIComponent(systemId)}/stations/${encodeURIComponent(stationId)}/recent`,
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = await res.json() as TypicalResponse
    if (!container.isConnected) return
    container.innerHTML = `
      <div class="flex items-center justify-between gap-2 text-[10px] text-neutral-500 mb-1">
        <span class="font-medium">${body.label}</span>
        <span>${body.daysCovered} day${body.daysCovered === 1 ? '' : 's'} of history</span>
      </div>
      ${buildSparklineSVG(body, currentBikes)}
    `
  } catch {
    if (!container.isConnected) return
    container.innerHTML = `
      <div class="text-[10px] text-neutral-500 mb-1">Typical (no history yet)</div>
      ${buildSparklineSVG(
        { stationId, hours: emptyHours(), currentHour: new Date().getHours(), currentDow: new Date().getDay(), daysCovered: 0, isDowFiltered: false, label: '', timezone: '' },
        currentBikes,
      )}
    `
  }
}

function emptyHours(): HourBucket[] {
  return Array.from({ length: 24 }, (_, h) => ({ hour: h, bikes: 0, docks: 0, samples: 0 }))
}

function buildSparklineSVG(body: TypicalResponse, currentBikes: number): string {
  const slotWidth = (SVG_W - 2 * PAD) / 24
  const histMax = Math.max(0, ...body.hours.map(h => h.bikes))
  const yMax = Math.max(1, histMax, currentBikes)
  const chartH = SVG_H - 2 * PAD - 2
  const scaleY = (v: number) => (v / yMax) * chartH

  let bars = ''
  for (let i = 0; i < 24; i++) {
    const h = body.hours[i]!
    const isCurrentHour = i === body.currentHour
    const hasData = h.samples > 0

    const x = PAD + i * slotWidth + 0.5
    const w = Math.max(1, slotWidth - 1)

    const histH = scaleY(h.bikes)
    const histY = SVG_H - PAD - histH
    const histFill = hasData ? HIST_COLOR : EMPTY_COLOR
    const histOpacity = isCurrentHour && hasData ? 0.35 : hasData ? 0.85 : 0.55
    bars += `<rect x="${x.toFixed(1)}" y="${histY.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(0.5, histH).toFixed(1)}" fill="${histFill}" opacity="${histOpacity}"><title>${hasData ? `${h.bikes.toFixed(1)} bikes typical at ${labelHour(h.hour)} (${h.samples} samples)` : `${labelHour(h.hour)}: no history`}</title></rect>`

    if (isCurrentHour) {
      const liveH = scaleY(currentBikes)
      const liveY = SVG_H - PAD - liveH
      const overlayW = Math.max(1, w * 0.55)
      const overlayX = x + (w - overlayW) / 2
      bars += `<rect x="${overlayX.toFixed(1)}" y="${liveY.toFixed(1)}" width="${overlayW.toFixed(1)}" height="${Math.max(0.5, liveH).toFixed(1)}" fill="${LIVE_COLOR}"><title>Right now: ${currentBikes} bikes</title></rect>`
    }
  }

  const baseline = `<line x1="${PAD}" y1="${SVG_H - PAD}" x2="${SVG_W - PAD}" y2="${SVG_H - PAD}" stroke="${BASELINE_COLOR}" stroke-width="0.5"/>`
  return `<svg viewBox="0 0 ${SVG_W} ${SVG_H}" width="100%" height="${SVG_H}" xmlns="http://www.w3.org/2000/svg" aria-label="Typical 24-hour profile with live overlay">${baseline}${bars}</svg>`
}

function labelHour(h: number): string {
  if (h === 0) return '12am'
  if (h === 12) return 'noon'
  return h < 12 ? `${h}am` : `${h - 12}pm`
}
