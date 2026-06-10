import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { sendBeacon } from '../lib/analytics'

/**
 * Fires a pageview beacon on every route change. The actual POST + session
 * handling + dev-skip live in lib/analytics (shared with trackEvent); this
 * hook just owns the route-change effect and dedupe.
 */
export function useBeaconReporter() {
  const location = useLocation()
  const lastPath = useRef<string | null>(null)

  useEffect(() => {
    const path = location.pathname
    // Dedupe — useLocation can fire multiple times for the same path during render churn
    if (lastPath.current === path) return
    lastPath.current = path

    const viewport = typeof window !== 'undefined'
      ? `${window.innerWidth}x${window.innerHeight}`
      : null
    const referrer = (typeof document !== 'undefined' && document.referrer) || null

    sendBeacon({ type: 'pageview', path, referrer, viewport })
  }, [location.pathname])
}
