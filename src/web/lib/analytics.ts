// Homegrown, dependency-free analytics client. Shared by the pageview
// reporter (useBeaconReporter) and interaction tracking (trackEvent). Both
// POST to /api/beacon, which stores one immutable object per event in R2.
//
// Everything here is best-effort and silently no-ops on failure — analytics
// must never degrade navigation or interaction.

const API_BASE = import.meta.env.VITE_API_BASE ?? ''
const SESSION_STORAGE_KEY = 'bcycle-map-session-id'

/** Stable per-tab id. Anonymous random string; not PII. */
export function getOrCreateSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_STORAGE_KEY)
    if (existing) return existing
    const fresh = Math.random().toString(36).slice(2) + Date.now().toString(36)
    sessionStorage.setItem(SESSION_STORAGE_KEY, fresh)
    return fresh
  } catch {
    // sessionStorage can throw in private-mode browsers
    return 'anon'
  }
}

type BeaconBody = {
  type: 'pageview' | 'event'
  path: string
  name?: string
  props?: Record<string, string>
  referrer?: string | null
  viewport?: string | null
}

/**
 * Fire-and-forget POST to /api/beacon. Skipped in dev so local clicking never
 * pollutes prod analytics. `keepalive` lets it complete across navigations.
 */
export function sendBeacon(body: BeaconBody): void {
  if (import.meta.env.DEV) return
  try {
    fetch(`${API_BASE}/api/beacon`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, session: getOrCreateSessionId() }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // JSON.stringify or fetch construction can throw — never surface it
  }
}

/** Coerce a caller's props into the string map the endpoint expects. */
function stringifyProps(props?: Record<string, unknown>): Record<string, string> | undefined {
  if (!props) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue
    out[k] = typeof v === 'string' ? v : String(v)
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * Record an interaction event (route check run, station opened, etc). Reads
 * the current path from the location bar — safe because this is only ever
 * called from event handlers, never during render.
 */
export function trackEvent(name: string, props?: Record<string, unknown>): void {
  const path = typeof window !== 'undefined' ? window.location.pathname : '/'
  const viewport = typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : null
  sendBeacon({ type: 'event', path, name, props: stringifyProps(props), viewport })
}
