type Bucket = { ts: number; bikes: number; docks: number; samples: number }

const SVG_W = 220
const SVG_H = 44
const PAD = 2

const HIST_COLOR = '#0d6cb0'  // historical avg — BCycle blue
const LIVE_COLOR = '#ea580c'  // live now — orange-600, contrasts blue
const EMPTY_COLOR = '#e5e7eb' // no-data ghost
const BASELINE_COLOR = '#d1d5db'

/**
 * Fetches 24h of hourly buckets for a station from the read-api Worker
 * and renders a sparkline bar chart into the given container. The current
 * live value (last argument) is overlaid in a different color at the current
 * hour's slot — like Google Maps' "live vs typical" activity view.
 *
 * No-op if the container is detached (popup closed before fetch completed).
 */
export async function renderSparkline(
  container: HTMLElement,
  apiBase: string,
  systemId: string,
  stationId: string,
  currentBikes: number,
): Promise<void> {
  container.innerHTML = '<div class="text-xs text-neutral-400 italic">Loading recent history…</div>'
  try {
    const res = await fetch(
      `${apiBase}/api/systems/${encodeURIComponent(systemId)}/stations/${encodeURIComponent(stationId)}/recent?hours=24`,
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = await res.json() as { buckets: Bucket[] }
    if (!container.isConnected) return
    container.innerHTML = buildSparklineSVG(body.buckets ?? [], currentBikes)
  } catch {
    if (!container.isConnected) return
    // Even on a failed fetch, render an all-ghost chart with the live overlay,
    // so the user always sees the same shape rather than an error string.
    container.innerHTML = buildSparklineSVG([], currentBikes)
  }
}

function buildSparklineSVG(buckets: Bucket[], currentBikes: number): string {
  const nowTs = Math.floor(Date.now() / 1000)
  const slotCount = 24
  const slotWidth = (SVG_W - 2 * PAD) / slotCount
  const lastBucketTs = Math.floor(nowTs / 3600) * 3600

  const byTs = new Map<number, Bucket>()
  for (const b of buckets) byTs.set(b.ts, b)

  // Y scale: include live value so the overlay is never clipped
  const histMax = Math.max(0, ...buckets.map(b => b.bikes))
  const yMax = Math.max(1, histMax, currentBikes)
  const chartH = SVG_H - 2 * PAD - 2
  const scaleY = (v: number) => (v / yMax) * chartH

  let bars = ''
  for (let i = 0; i < slotCount; i++) {
    const slotTs = lastBucketTs - (slotCount - 1 - i) * 3600
    const isCurrentHour = i === slotCount - 1
    const b = byTs.get(slotTs)
    const histValue = b?.bikes ?? 0
    const hasData = !!b

    const x = PAD + i * slotWidth + 0.5
    const w = Math.max(1, slotWidth - 1)

    // Historical (or empty ghost) bar. Slightly faded under the live overlay on the current hour.
    const histH = scaleY(histValue)
    const histY = SVG_H - PAD - histH
    const histFill = hasData ? HIST_COLOR : EMPTY_COLOR
    const histOpacity = isCurrentHour && hasData ? 0.35 : hasData ? 0.9 : 0.5
    bars += `<rect x="${x.toFixed(1)}" y="${histY.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(0.5, histH).toFixed(1)}" fill="${histFill}" opacity="${histOpacity}"><title>${hasData ? `Typical: ${histValue.toFixed(1)} bikes` : 'No history yet'}</title></rect>`

    // Live overlay at the current hour. Narrower than the slot so the historical bar peeks at the edges.
    if (isCurrentHour) {
      const liveH = scaleY(currentBikes)
      const liveY = SVG_H - PAD - liveH
      const overlayW = Math.max(1, w * 0.55)
      const overlayX = x + (w - overlayW) / 2
      bars += `<rect x="${overlayX.toFixed(1)}" y="${liveY.toFixed(1)}" width="${overlayW.toFixed(1)}" height="${Math.max(0.5, liveH).toFixed(1)}" fill="${LIVE_COLOR}"><title>Right now: ${currentBikes} bikes</title></rect>`
    }
  }

  const baseline = `<line x1="${PAD}" y1="${SVG_H - PAD}" x2="${SVG_W - PAD}" y2="${SVG_H - PAD}" stroke="${BASELINE_COLOR}" stroke-width="0.5"/>`

  return `<svg viewBox="0 0 ${SVG_W} ${SVG_H}" width="100%" height="${SVG_H}" xmlns="http://www.w3.org/2000/svg" aria-label="Last 24 hours of bikes available with live overlay">${baseline}${bars}</svg>`
}
