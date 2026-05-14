type Bucket = { ts: number; bikes: number; docks: number; samples: number }

const SVG_W = 220
const SVG_H = 44
const PAD = 2

/**
 * Fetches 24h of hourly buckets for a station from the read-api Worker
 * and renders a sparkline bar chart of bikes-available into the given
 * container element. No-op if the container is detached (popup closed
 * before fetch completed).
 */
export async function renderSparkline(
  container: HTMLElement,
  apiBase: string,
  systemId: string,
  stationId: string,
): Promise<void> {
  container.innerHTML = '<div class="text-xs text-neutral-400 italic">Loading recent history…</div>'
  try {
    const res = await fetch(
      `${apiBase}/api/systems/${encodeURIComponent(systemId)}/stations/${encodeURIComponent(stationId)}/recent?hours=24`,
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = await res.json() as { buckets: Bucket[] }
    if (!container.isConnected) return
    if (!body.buckets || body.buckets.length === 0) {
      container.innerHTML = '<div class="text-xs text-neutral-400 italic">No 24h history yet.</div>'
      return
    }
    container.innerHTML = buildSparklineSVG(body.buckets)
  } catch {
    if (!container.isConnected) return
    container.innerHTML = '<div class="text-xs text-neutral-400 italic">History unavailable.</div>'
  }
}

function buildSparklineSVG(buckets: Bucket[]): string {
  const max = Math.max(1, ...buckets.map(b => b.bikes))
  const nowTs = Math.floor(Date.now() / 1000)
  // 24 evenly spaced slots ending at the current hour
  const slotCount = 24
  const slotWidth = (SVG_W - 2 * PAD) / slotCount

  const lastBucketTs = Math.floor(nowTs / 3600) * 3600
  // Build a map from bucket-hour-ts → value so missing hours render as faded ghosts
  const byTs = new Map<number, Bucket>()
  for (const b of buckets) byTs.set(b.ts, b)

  let bars = ''
  for (let i = 0; i < slotCount; i++) {
    const slotTs = lastBucketTs - (slotCount - 1 - i) * 3600
    const b = byTs.get(slotTs)
    const value = b?.bikes ?? 0
    const hasData = !!b
    const h = (value / max) * (SVG_H - 2 * PAD - 10) // leave room for label at top
    const x = PAD + i * slotWidth + 0.5
    const y = SVG_H - PAD - h
    const w = Math.max(1, slotWidth - 1)
    const fill = hasData ? '#0d6cb0' : '#e5e7eb'
    const opacity = hasData ? 0.9 : 0.6
    bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(0.5, h).toFixed(1)}" fill="${fill}" opacity="${opacity}"><title>${hasData ? `${value} bikes avg at ${new Date(slotTs * 1000).toLocaleTimeString([], { hour: 'numeric' })}` : 'No data'}</title></rect>`
  }

  // Tiny baseline + max label
  const baseline = `<line x1="${PAD}" y1="${SVG_H - PAD}" x2="${SVG_W - PAD}" y2="${SVG_H - PAD}" stroke="#d1d5db" stroke-width="0.5"/>`
  const maxLabel = `<text x="${SVG_W - PAD - 2}" y="${PAD + 9}" text-anchor="end" font-size="9" fill="#9ca3af">max ${max}</text>`

  return `<svg viewBox="0 0 ${SVG_W} ${SVG_H}" width="100%" height="${SVG_H}" xmlns="http://www.w3.org/2000/svg" aria-label="Last 24h bikes available">${baseline}${bars}${maxLabel}</svg>`
}
