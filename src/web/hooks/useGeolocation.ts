import { useCallback, useEffect, useState } from 'react'

/**
 * One-shot geolocation hook for the nearby-stations sheet.
 *
 * The browser's permission prompt MUST appear in response to a user gesture,
 * so this hook never calls `navigator.geolocation` on mount. Consumers wire
 * `request()` to a button click. We remember a granted permission in
 * localStorage so a second visit can skip the prompt entirely — though
 * the actual coords are not cached (location stale-ness is too risky to fake).
 */

export type GeolocationStatus =
  | 'idle'
  | 'requesting'
  | 'granted'
  | 'denied'
  | 'unavailable'

export type GeolocationCoords = {
  lat: number
  lon: number
  /** Reported accuracy in meters; undefined on devices that omit it. */
  accuracy?: number
}

export type UseGeolocationResult = {
  status: GeolocationStatus
  coords: GeolocationCoords | null
  error: string | null
  /** Triggers the permission prompt + a single getCurrentPosition call. */
  request: () => void
  /** Wipes the cached grant + local state. Used by the "use a different location" affordance. */
  reset: () => void
  /** True if a previous session granted the prompt — used to skip the consent copy. */
  previouslyGranted: boolean
}

const LS_KEY = 'bcycle-map:geolocation-granted'

function readPreviouslyGranted(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(LS_KEY) === '1'
  } catch {
    return false
  }
}

function writeGranted(value: boolean) {
  if (typeof window === 'undefined') return
  try {
    if (value) window.localStorage.setItem(LS_KEY, '1')
    else window.localStorage.removeItem(LS_KEY)
  } catch {
    // Private mode etc. — ignore; the rest of the flow still works.
  }
}

export function useGeolocation(): UseGeolocationResult {
  const [status, setStatus] = useState<GeolocationStatus>('idle')
  const [coords, setCoords] = useState<GeolocationCoords | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [previouslyGranted, setPreviouslyGranted] = useState<boolean>(() => readPreviouslyGranted())

  // Keep the cached-grant flag fresh if it changes in another tab.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_KEY) setPreviouslyGranted(readPreviouslyGranted())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const request = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('unavailable')
      setError('Geolocation is not supported in this browser.')
      return
    }
    setStatus('requesting')
    setError(null)
    navigator.geolocation.getCurrentPosition(
      pos => {
        setCoords({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        })
        setStatus('granted')
        if (!readPreviouslyGranted()) {
          writeGranted(true)
          setPreviouslyGranted(true)
        }
      },
      err => {
        // PERMISSION_DENIED = 1, POSITION_UNAVAILABLE = 2, TIMEOUT = 3
        if (err.code === 1) {
          setStatus('denied')
          setError('Location permission denied.')
          // Clear any stale grant so the consent copy reappears next time.
          writeGranted(false)
          setPreviouslyGranted(false)
        } else {
          setStatus('unavailable')
          setError(err.message || 'Could not get your location.')
        }
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 },
    )
  }, [])

  const reset = useCallback(() => {
    setStatus('idle')
    setCoords(null)
    setError(null)
    writeGranted(false)
    setPreviouslyGranted(false)
  }, [])

  return { status, coords, error, request, reset, previouslyGranted }
}
