import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

const API_BASE = import.meta.env.VITE_API_BASE ?? ''
const SESSION_STORAGE_KEY = 'bcycle-map-session-id'

function getOrCreateSessionId(): string {
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

/**
 * Fires a fire-and-forget beacon to /api/beacon on every route change.
 * The endpoint best-effort writes to R2 daily aggregate files; failures
 * are silently swallowed so navigation never degrades.
 *
 * Skipped in dev (`import.meta.env.DEV`) so Sam's local clicking doesn't
 * pollute production analytics.
 */
export function useBeaconReporter() {
  const location = useLocation()
  const lastPath = useRef<string | null>(null)

  useEffect(() => {
    if (import.meta.env.DEV) return
    const path = location.pathname
    // Dedupe — useLocation can fire multiple times for the same path during render churn
    if (lastPath.current === path) return
    lastPath.current = path

    const viewport = typeof window !== 'undefined'
      ? `${window.innerWidth}x${window.innerHeight}`
      : null
    const session = getOrCreateSessionId()
    const referrer = (typeof document !== 'undefined' && document.referrer) || null

    fetch(`${API_BASE}/api/beacon`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, session, referrer, viewport }),
      keepalive: true,  // let it complete even if the user navigates away
    }).catch(() => {})
  }, [location.pathname])
}
