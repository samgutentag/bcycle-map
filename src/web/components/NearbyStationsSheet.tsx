import { useEffect, useMemo, useState } from 'react'
import type { StationSnapshot } from '@shared/types'
import { useGeolocation } from '../hooks/useGeolocation'
import {
  formatWalkingDistance,
  HALF_MILE_M,
  haversineMeters,
  ONE_MILE_M,
} from '../lib/distance'

const MOBILE_BREAKPOINT = 640
const MAX_RESULTS = 3

export type NearbyMode = 'bike' | 'dock'

type Props = {
  stations: StationSnapshot[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Ranked = {
  station: StationSnapshot
  meters: number
}

/**
 * Pick the top N stations within `radiusM` of `origin` that have at least one
 * unit of the requested resource (bike or dock), sorted by ascending distance.
 * Offline stations (not installed, not renting/returning) are excluded.
 */
function pickNearby(
  stations: StationSnapshot[],
  origin: { lat: number; lon: number },
  mode: NearbyMode,
  radiusM: number,
  limit: number,
): Ranked[] {
  const ranked: Ranked[] = []
  for (const s of stations) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue
    if (!s.is_installed) continue
    if (mode === 'bike' && (!s.is_renting || s.num_bikes_available < 1)) continue
    if (mode === 'dock' && (!s.is_returning || s.num_docks_available < 1)) continue
    const meters = haversineMeters(origin, { lat: s.lat, lon: s.lon })
    if (meters > radiusM) continue
    ranked.push({ station: s, meters })
  }
  ranked.sort((a, b) => a.meters - b.meters)
  return ranked.slice(0, limit)
}

function mapsUrlFor(origin: { lat: number; lon: number } | null, s: StationSnapshot): string {
  // Walking directions from current location → station. If we don't have an
  // origin (shouldn't happen on this code path) we drop to a search URL.
  if (origin) {
    return (
      `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lon}` +
      `&destination=${s.lat},${s.lon}&travelmode=walking`
    )
  }
  return `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lon}`
}

export default function NearbyStationsSheet({ stations, open, onOpenChange }: Props) {
  const geo = useGeolocation()
  const [mode, setMode] = useState<NearbyMode>('bike')
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`)
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Auto-trigger the geolocation request when the sheet opens IF the user has
  // previously granted permission. First-time opens still require a click on
  // the "Use my location" button — that keeps the prompt user-gesture-driven.
  useEffect(() => {
    if (!open) return
    if (geo.status !== 'idle') return
    if (!geo.previouslyGranted) return
    geo.request()
  }, [open, geo])

  const { results, radiusUsed } = useMemo<{
    results: Ranked[]
    radiusUsed: 'half' | 'one' | null
  }>(() => {
    if (!geo.coords) return { results: [], radiusUsed: null }
    const half = pickNearby(stations, geo.coords, mode, HALF_MILE_M, MAX_RESULTS)
    if (half.length > 0) return { results: half, radiusUsed: 'half' }
    const wide = pickNearby(stations, geo.coords, mode, ONE_MILE_M, MAX_RESULTS)
    return { results: wide, radiusUsed: wide.length > 0 ? 'one' : null }
  }, [stations, geo.coords, mode])

  if (!open) return null

  // ─── Container styles ─────────────────────────────────────────────────
  const desktopCss = {
    position: 'absolute' as const,
    left: 16,
    bottom: 16,
    width: 360,
    maxWidth: 'calc(100vw - 32px)',
    background: 'var(--app-bg-surface)',
    borderRadius: 12,
    border: '1px solid var(--app-border, rgba(0,0,0,0.08))',
    boxShadow: '0 8px 24px rgba(0,0,0,0.16)',
    display: 'flex',
    flexDirection: 'column' as const,
    zIndex: 25,
  }

  const mobileCss = {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '60vh',
    background: 'var(--app-bg-surface)',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    border: '1px solid var(--app-border, rgba(0,0,0,0.08))',
    borderBottom: 'none',
    boxShadow: '0 -8px 24px rgba(0,0,0,0.18)',
    display: 'flex',
    flexDirection: 'column' as const,
    zIndex: 25,
  }

  const containerCss = isMobile ? mobileCss : desktopCss

  return (
    <aside
      role="dialog"
      aria-label="Nearby stations"
      data-testid="nearby-sheet"
      css={containerCss}
    >
      {/* Header: title + close */}
      <header
        css={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 14px',
          borderBottom: '1px solid var(--app-border, rgba(0,0,0,0.08))',
        }}
      >
        <div css={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span
            css={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--app-text-heading, #111)',
            }}
          >
            Where&apos;s a bike near me
          </span>
          {radiusUsed && (
            <span
              data-testid="nearby-sheet-radius"
              css={{ fontSize: 11, color: 'var(--app-text-subdued, #666)' }}
            >
              {radiusUsed === 'half' ? 'Within 0.5 mi' : 'Closest within 1 mi'}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label="Close nearby stations"
          data-testid="nearby-sheet-close"
          css={{
            all: 'unset',
            cursor: 'pointer',
            padding: 4,
            fontSize: 16,
            lineHeight: 1,
            color: 'var(--app-text-subdued, #666)',
            '&:hover': { color: 'var(--app-text-heading, #111)' },
          }}
        >
          ✕
        </button>
      </header>

      {/* Mode toggle: Find a bike / Find a dock */}
      <div
        css={{
          display: 'flex',
          gap: 4,
          padding: '10px 14px 0',
        }}
      >
        <ModeButton
          active={mode === 'bike'}
          label="Find a bike"
          onClick={() => setMode('bike')}
          testId="nearby-sheet-mode-bike"
        />
        <ModeButton
          active={mode === 'dock'}
          label="Find a dock"
          onClick={() => setMode('dock')}
          testId="nearby-sheet-mode-dock"
        />
      </div>

      {/* Body — varies by geolocation status */}
      <div
        css={{
          padding: 14,
          overflow: 'auto',
          flex: '1 1 auto',
        }}
      >
        {geo.status === 'idle' && (
          <PermissionPrompt
            previouslyGranted={geo.previouslyGranted}
            onRequest={() => geo.request()}
          />
        )}

        {geo.status === 'requesting' && (
          <p
            data-testid="nearby-sheet-loading"
            css={{ fontSize: 13, color: 'var(--app-text-subdued, #666)', margin: 0 }}
          >
            Locating you…
          </p>
        )}

        {geo.status === 'denied' && (
          <DeniedState onRetry={() => geo.request()} />
        )}

        {geo.status === 'unavailable' && (
          <UnavailableState message={geo.error} onRetry={() => geo.request()} />
        )}

        {geo.status === 'granted' && (
          <ResultsList
            results={results}
            origin={geo.coords}
            mode={mode}
            radiusUsed={radiusUsed}
          />
        )}
      </div>
    </aside>
  )
}

function ModeButton({
  active,
  label,
  onClick,
  testId,
}: {
  active: boolean
  label: string
  onClick: () => void
  testId: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      css={{
        all: 'unset',
        cursor: 'pointer',
        flex: 1,
        textAlign: 'center',
        padding: '6px 8px',
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 600,
        border: '1px solid var(--app-border, rgba(0,0,0,0.12))',
        background: active ? '#0d6cb0' : 'transparent',
        color: active ? 'white' : 'var(--app-text-subdued, #555)',
      }}
    >
      {label}
    </button>
  )
}

function PermissionPrompt({
  previouslyGranted,
  onRequest,
}: {
  previouslyGranted: boolean
  onRequest: () => void
}) {
  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p css={{ margin: 0, fontSize: 13, color: 'var(--app-text-default, #222)' }}>
        {previouslyGranted
          ? 'Tap to use your current location.'
          : 'Use your location to surface the closest stations with bikes or open docks. We only check your position once per visit and never store the coordinates.'}
      </p>
      <button
        type="button"
        data-testid="nearby-sheet-request"
        onClick={onRequest}
        css={{
          all: 'unset',
          cursor: 'pointer',
          alignSelf: 'flex-start',
          padding: '8px 14px',
          borderRadius: 8,
          background: '#0d6cb0',
          color: 'white',
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        Use my location
      </button>
    </div>
  )
}

function DeniedState({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      data-testid="nearby-sheet-denied"
      css={{ display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <p css={{ margin: 0, fontSize: 13, color: 'var(--app-text-default, #222)' }}>
        {/* TODO(#47): swap the "re-enable in browser settings" copy for a
            geocoded address input once the Google Maps key is wired through. */}
        Location permission was denied. Re-enable it in your browser settings,
        then try again. Manual address lookup is coming in a follow-up.
      </p>
      <button
        type="button"
        onClick={onRetry}
        data-testid="nearby-sheet-retry"
        css={{
          all: 'unset',
          cursor: 'pointer',
          alignSelf: 'flex-start',
          padding: '6px 12px',
          borderRadius: 6,
          border: '1px solid var(--app-border, rgba(0,0,0,0.12))',
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--app-text-default, #222)',
        }}
      >
        Try again
      </button>
    </div>
  )
}

function UnavailableState({
  message,
  onRetry,
}: {
  message: string | null
  onRetry: () => void
}) {
  return (
    <div
      data-testid="nearby-sheet-unavailable"
      css={{ display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <p css={{ margin: 0, fontSize: 13, color: 'var(--app-text-default, #222)' }}>
        {message ?? 'Could not get your location.'}
      </p>
      <button
        type="button"
        onClick={onRetry}
        data-testid="nearby-sheet-retry"
        css={{
          all: 'unset',
          cursor: 'pointer',
          alignSelf: 'flex-start',
          padding: '6px 12px',
          borderRadius: 6,
          border: '1px solid var(--app-border, rgba(0,0,0,0.12))',
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--app-text-default, #222)',
        }}
      >
        Try again
      </button>
    </div>
  )
}

function ResultsList({
  results,
  origin,
  mode,
  radiusUsed,
}: {
  results: Ranked[]
  origin: { lat: number; lon: number } | null
  mode: NearbyMode
  radiusUsed: 'half' | 'one' | null
}) {
  if (results.length === 0) {
    return (
      <p
        data-testid="nearby-sheet-empty"
        css={{ margin: 0, fontSize: 13, color: 'var(--app-text-subdued, #666)' }}
      >
        {radiusUsed === null
          ? mode === 'bike'
            ? 'No stations with bikes within 1 mi.'
            : 'No stations with open docks within 1 mi.'
          : 'No stations found.'}
      </p>
    )
  }
  return (
    <ul
      data-testid="nearby-sheet-results"
      css={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {results.map(({ station, meters }) => (
        <li
          key={station.station_id}
          data-testid="nearby-sheet-row"
          css={{
            padding: 10,
            borderRadius: 8,
            border: '1px solid var(--app-border, rgba(0,0,0,0.08))',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div css={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span
              css={{
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--app-text-heading, #111)',
              }}
            >
              {station.name}
            </span>
            <span
              css={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--app-text-subdued, #555)',
                whiteSpace: 'nowrap',
              }}
            >
              {formatWalkingDistance(meters)}
            </span>
          </div>
          <div css={{ display: 'flex', gap: 12, fontSize: 12 }}>
            <span>
              <strong css={{ color: 'var(--app-text-heading, #111)' }}>
                {station.num_bikes_available}
              </strong>{' '}
              <span css={{ color: 'var(--app-text-subdued, #666)' }}>bikes</span>
            </span>
            <span>
              <strong css={{ color: 'var(--app-text-heading, #111)' }}>
                {station.num_docks_available}
              </strong>{' '}
              <span css={{ color: 'var(--app-text-subdued, #666)' }}>docks</span>
            </span>
          </div>
          <div css={{ display: 'flex', gap: 12, fontSize: 12 }}>
            <a
              href={mapsUrlFor(origin, station)}
              target="_blank"
              rel="noopener noreferrer"
              css={{ color: '#0d6cb0', textDecoration: 'none', fontWeight: 600 }}
            >
              Open in Maps ↗
            </a>
            <a
              href={`/station/${encodeURIComponent(station.station_id)}/details`}
              css={{ color: '#0d6cb0', textDecoration: 'none', fontWeight: 600 }}
            >
              Details →
            </a>
          </div>
        </li>
      ))}
    </ul>
  )
}
