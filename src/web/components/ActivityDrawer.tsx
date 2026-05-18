import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { StationSnapshot, Trip } from '@shared/types'
import { useActivity } from '../hooks/useActivity'
import { useTravelMatrix } from '../hooks/useTravelMatrix'
import { useRouteCache } from '../hooks/useRouteCache'
import ActivityLog from './ActivityLog'
import TripRouteModal from './TripRouteModal'

const SYSTEM_ID = 'bcycle_santabarbara'
const R2_BASE = import.meta.env.VITE_R2_PUBLIC_URL ?? 'https://pub-83059e704dd64536a5166ab289eb42e5.r2.dev'

const COLLAPSED_WIDTH = 40
const EXPANDED_WIDTH = 380
const MOBILE_BREAKPOINT = 640
const MOBILE_HEIGHT_VH = 40

type Props = {
  /** Stations from the live snapshot — used to look up names in the ticker and inner log. */
  stations: StationSnapshot[]
  /** IANA timezone for time formatting. */
  timezone?: string
}

/**
 * Right-edge collapsible drawer on /live that surfaces the live activity feed.
 *
 * Collapsed (default): thin vertical strip with a vertical "Activity" label,
 * an unread-count badge, and a single-line ticker of the most recent event.
 *
 * Expanded: 380px wide panel hosting the existing ActivityLog component
 * (events-only by default; a toggle inside the drawer flips on the trips column).
 *
 * State persists in the URL as `?activity=open` so it survives reloads and is
 * shareable. On viewports <= 640px the drawer slides up from the bottom as a
 * sheet (~40vh) instead of from the right edge.
 */
export default function ActivityDrawer({ stations, timezone }: Props) {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlOpen = searchParams.get('activity') === 'open'
  const [open, setOpen] = useState(urlOpen)
  const [showTrips, setShowTrips] = useState(false)
  const [openTrip, setOpenTrip] = useState<Trip | null>(null)
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches
  })

  const { data: activity } = useActivity(SYSTEM_ID)
  // Trip modal data — only fetched when the drawer is mounted; cheap because
  // useTravelMatrix/useRouteCache cache the R2 fetch in module state.
  const matrix = useTravelMatrix(R2_BASE, SYSTEM_ID)
  const routes = useRouteCache(R2_BASE, SYSTEM_ID)

  // Track viewport size to swap between right-edge drawer and bottom sheet.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`)
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Keep the local open state in sync with the URL when the user navigates
  // forward/back or lands on a shared `?activity=open` URL.
  useEffect(() => {
    setOpen(urlOpen)
  }, [urlOpen])

  const setOpenAndUrl = useCallback((next: boolean) => {
    setOpen(next)
    setSearchParams(prev => {
      const updated = new URLSearchParams(prev)
      if (next) updated.set('activity', 'open')
      else updated.delete('activity')
      return updated
    }, { replace: true })
  }, [setSearchParams])

  // Track the timestamp of the latest event seen the last time the drawer was
  // opened. New events that arrive after that ts contribute to the unread count.
  // Reset whenever the drawer opens.
  const lastSeenTsRef = useRef<number>(Math.floor(Date.now() / 1000))
  const [unreadCount, setUnreadCount] = useState(0)

  const events = activity?.events ?? []
  const latestEvent = events.length > 0 ? events[events.length - 1] : null

  // When the drawer opens, mark the latest event as "seen" and clear unread.
  useEffect(() => {
    if (!open) return
    lastSeenTsRef.current = latestEvent ? latestEvent.ts : Math.floor(Date.now() / 1000)
    setUnreadCount(0)
  }, [open, latestEvent])

  // When new events stream in while the drawer is closed, bump unread.
  useEffect(() => {
    if (open) return
    const newer = events.filter(e => e.ts > lastSeenTsRef.current).length
    setUnreadCount(newer)
  }, [open, events])

  const stationNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of stations) m.set(s.station_id, s.name)
    return m
  }, [stations])

  const tickerText = useMemo(() => {
    if (!latestEvent) return 'No movement yet…'
    const name = stationNameById.get(latestEvent.station_id) ?? latestEvent.station_id
    const sign = latestEvent.type === 'departure' ? '−' : '+'
    const deltaText = `${sign}${latestEvent.delta} bike${latestEvent.delta === 1 ? '' : 's'}`
    const ageSec = Math.max(0, Math.floor(Date.now() / 1000) - latestEvent.ts)
    const ageText = ageSec < 60 ? `${ageSec}s ago` : ageSec < 3600 ? `${Math.floor(ageSec / 60)}m ago` : `${Math.floor(ageSec / 3600)}h ago`
    return `${name}: ${deltaText}, ${ageText}`
  }, [latestEvent, stationNameById])

  // ─── Styles ──────────────────────────────────────────────────────────
  // Anchored as a right-edge panel on desktop; bottom sheet on mobile.
  // z-index 30 sits above SystemTotals (no explicit z) but below modals (50).
  const collapsedDesktop = {
    position: 'absolute' as const,
    top: 16,
    right: 0,
    bottom: 16,
    width: COLLAPSED_WIDTH,
    background: 'var(--app-bg-surface)',
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
    border: '1px solid var(--app-border, rgba(0,0,0,0.08))',
    borderRight: 'none',
    boxShadow: '-2px 0 8px rgba(0,0,0,0.06)',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 4px',
    cursor: 'pointer',
    zIndex: 30,
    transition: 'width 220ms ease, transform 220ms ease',
  }

  const expandedDesktop = {
    position: 'absolute' as const,
    top: 16,
    right: 0,
    bottom: 16,
    width: EXPANDED_WIDTH,
    background: 'var(--app-bg-surface)',
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
    border: '1px solid var(--app-border, rgba(0,0,0,0.08))',
    borderRight: 'none',
    boxShadow: '-4px 0 16px rgba(0,0,0,0.12)',
    display: 'flex',
    flexDirection: 'column' as const,
    zIndex: 30,
    transition: 'width 220ms ease, transform 220ms ease',
  }

  const collapsedMobile = {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    bottom: 0,
    height: 44,
    background: 'var(--app-bg-surface)',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    border: '1px solid var(--app-border, rgba(0,0,0,0.08))',
    borderBottom: 'none',
    boxShadow: '0 -2px 8px rgba(0,0,0,0.08)',
    display: 'flex',
    flexDirection: 'row' as const,
    alignItems: 'center',
    padding: '0 12px',
    gap: 8,
    cursor: 'pointer',
    zIndex: 30,
    transition: 'height 220ms ease',
  }

  const expandedMobile = {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    bottom: 0,
    height: `${MOBILE_HEIGHT_VH}vh`,
    background: 'var(--app-bg-surface)',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    border: '1px solid var(--app-border, rgba(0,0,0,0.08))',
    borderBottom: 'none',
    boxShadow: '0 -4px 16px rgba(0,0,0,0.16)',
    display: 'flex',
    flexDirection: 'column' as const,
    zIndex: 30,
    transition: 'height 220ms ease',
  }

  // ─── Render ──────────────────────────────────────────────────────────
  // Collapsed strip: clicking anywhere opens; rotated "Activity" label,
  // unread badge, and (on desktop) a vertical ticker. On mobile the ticker
  // sits inline horizontally in a thin bar across the bottom.
  if (!open) {
    if (isMobile) {
      return (
        <div
          role="button"
          tabIndex={0}
          aria-label="Open activity feed"
          aria-expanded={false}
          data-testid="activity-drawer-collapsed"
          onClick={() => setOpenAndUrl(true)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenAndUrl(true) } }}
          css={collapsedMobile}
        >
          <span
            css={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--app-text-heading, #111)',
            }}
          >
            Activity
          </span>
          {unreadCount > 0 && (
            <span
              data-testid="activity-drawer-unread-badge"
              css={{
                background: '#ea580c',
                color: 'white',
                fontSize: 10,
                fontWeight: 700,
                borderRadius: 10,
                padding: '1px 6px',
                minWidth: 18,
                textAlign: 'center',
              }}
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
          <span
            data-testid="activity-drawer-ticker"
            css={{
              flex: 1,
              fontSize: 11,
              color: 'var(--app-text-subdued, #666)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={tickerText}
          >
            {tickerText}
          </span>
          <span aria-hidden css={{ fontSize: 12, color: 'var(--app-text-subdued, #666)' }}>▲</span>
        </div>
      )
    }
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label="Open activity feed"
        aria-expanded={false}
        data-testid="activity-drawer-collapsed"
        onClick={() => setOpenAndUrl(true)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenAndUrl(true) } }}
        css={collapsedDesktop}
      >
        <div css={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <span aria-hidden css={{ fontSize: 14, color: 'var(--app-text-subdued, #666)' }}>◀</span>
          {unreadCount > 0 && (
            <span
              data-testid="activity-drawer-unread-badge"
              css={{
                background: '#ea580c',
                color: 'white',
                fontSize: 10,
                fontWeight: 700,
                borderRadius: 10,
                padding: '1px 6px',
                minWidth: 18,
                textAlign: 'center',
              }}
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>
        <div
          data-testid="activity-drawer-ticker"
          css={{
            writingMode: 'vertical-rl',
            transform: 'rotate(180deg)',
            fontSize: 11,
            color: 'var(--app-text-subdued, #666)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxHeight: '60%',
            letterSpacing: '0.02em',
          }}
          title={tickerText}
        >
          {tickerText}
        </div>
        <span
          css={{
            writingMode: 'vertical-rl',
            transform: 'rotate(180deg)',
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--app-text-heading, #111)',
          }}
        >
          Activity
        </span>
      </div>
    )
  }

  // Expanded — desktop right panel or mobile bottom sheet.
  const expandedCss = isMobile ? expandedMobile : expandedDesktop
  return (
    <>
      <aside
        role="dialog"
        aria-label="Activity feed"
        aria-expanded={true}
        data-testid="activity-drawer-expanded"
        css={expandedCss}
      >
        <header
          css={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 12px',
            borderBottom: '1px solid var(--app-border, rgba(0,0,0,0.08))',
            flex: '0 0 auto',
          }}
        >
          <div css={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              css={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--app-text-heading, #111)',
              }}
            >
              Activity
            </span>
            <button
              type="button"
              onClick={() => setShowTrips(s => !s)}
              aria-pressed={showTrips}
              data-testid="activity-drawer-trips-toggle"
              css={{
                all: 'unset',
                cursor: 'pointer',
                fontSize: 10,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                padding: '2px 8px',
                borderRadius: 4,
                border: '1px solid var(--app-border, rgba(0,0,0,0.12))',
                color: showTrips ? 'white' : 'var(--app-text-subdued, #666)',
                background: showTrips ? '#0d6cb0' : 'transparent',
              }}
            >
              Trips
            </button>
          </div>
          <button
            type="button"
            onClick={() => setOpenAndUrl(false)}
            aria-label="Close activity feed"
            data-testid="activity-drawer-close"
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

        <div
          css={{
            flex: '1 1 auto',
            overflow: 'auto',
            padding: 12,
          }}
        >
          {showTrips ? (
            <ActivityLog
              log={activity}
              stations={stations}
              matrix={matrix.data}
              timezone={timezone}
              maxEvents={50}
              maxTrips={30}
              unbounded
              onTripClick={setOpenTrip}
            />
          ) : (
            // Events-only view: feed ActivityLog an empty trips array so it
            // renders just the left column. The grid still renders a divider +
            // empty trips column, so we hide it with a wrapper that clips them.
            <div data-testid="activity-drawer-events-only" css={{
              '& > div > div:nth-of-type(2), & > div > div:nth-of-type(3)': { display: 'none' },
              '& > div': { display: 'block' },
            }}>
              <ActivityLog
                log={activity ? { ...activity, trips: [] } : null}
                stations={stations}
                matrix={matrix.data}
                timezone={timezone}
                maxEvents={50}
                unbounded
              />
            </div>
          )}
        </div>
      </aside>

      {openTrip && (
        <TripRouteModal
          trip={openTrip}
          stations={stations}
          matrix={matrix.data}
          routes={routes.data}
          systemTz={timezone ?? 'UTC'}
          onClose={() => setOpenTrip(null)}
        />
      )}
    </>
  )
}
