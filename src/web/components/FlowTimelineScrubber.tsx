import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Flex, Text, useTheme } from '@audius/harmony'
import { pickTickInterval } from '../lib/flow-window'
import { trackEvent } from '../lib/analytics'

/**
 * 24-hour timeline scrubber for the flow map.
 *
 * Input is a Unix-second cursor between `windowStart` and `windowEnd`. The
 * underlying control is an <input type="range"> for native a11y + keyboard
 * support (arrow keys = ±60s, home/end = jump). Tick marks every 3 hours are
 * positioned absolutely on top of the track.
 *
 * Play/pause is exposed via a button; the spacebar handler lives in the parent
 * (FlowMap) so it doesn't need keyboard focus on the scrubber itself.
 */

type Props = {
  cursorTs: number
  windowStart: number
  windowEnd: number
  playing: boolean
  onCursorChange: (ts: number) => void
  onPlayToggle: () => void
  /** Optional caption rendered on the right side, e.g. "showing 80 of 134 trips" */
  caption?: string | null
  /** IANA timezone for clock labels (e.g. "America/Los_Angeles"). UTC fallback. */
  timezone?: string
  /**
   * Departure timestamps of all known trips in the window. Drives the small
   * density bars on the track + the Prev/Next-trip jump buttons. Sparse on
   * quiet days; the markers make it obvious where the trips cluster.
   */
  tripTimestamps?: number[]
  /** Pool playback mode — shows trip counter instead of clock, hides timeline controls. */
  poolMode?: boolean
  /** e.g. "12 / 47" — progress through the trip pool. */
  poolProgress?: string
}

function formatClock(tsSec: number, timezone: string | undefined): string {
  return new Date(tsSec * 1000).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  })
}

function formatTick(
  tsSec: number,
  timezone: string | undefined,
  showMinutes: boolean,
): string {
  // Compact hour label for wide spans ("3 PM"); hour+minute for narrow spans
  // ("3:15 PM") so 15- and 30-minute ticks read as distinct labels.
  return new Date(tsSec * 1000).toLocaleTimeString(undefined, {
    hour: 'numeric',
    ...(showMinutes ? { minute: '2-digit' } : {}),
    timeZone: timezone,
  })
}

export default function FlowTimelineScrubber({
  cursorTs,
  windowStart,
  windowEnd,
  playing,
  onCursorChange,
  onPlayToggle,
  caption,
  timezone,
  tripTimestamps,
  poolMode,
  poolProgress,
}: Props) {
  const theme = useTheme()
  const trackRef = useRef<HTMLDivElement | null>(null)

  // Debounced usage tracking: scrubbing fires continuously, so coalesce each
  // gesture into a single `flow_used` event (1s trailing) per action kind.
  const flowTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const trackFlow = useCallback((action: 'scrub' | 'play') => {
    const timers = flowTimersRef.current
    if (timers[action]) clearTimeout(timers[action])
    timers[action] = setTimeout(() => {
      trackEvent('flow_used', { action })
      delete timers[action]
    }, 1000)
  }, [])
  useEffect(() => {
    const timers = flowTimersRef.current
    return () => { for (const t of Object.values(timers)) clearTimeout(t) }
  }, [])

  const handlePlayToggle = useCallback(() => {
    onPlayToggle()
    trackFlow('play')
  }, [onPlayToggle, trackFlow])

  // Sorted copy of trip departure timestamps for prev/next jumping +
  // density-marker rendering. Memoized so repeated sorts don't happen on
  // every parent render.
  const sortedTrips = useMemo(() => {
    if (!tripTimestamps || tripTimestamps.length === 0) return []
    return [...tripTimestamps].sort((a, b) => a - b)
  }, [tripTimestamps])

  const span = Math.max(1, windowEnd - windowStart)
  const tripMarkers = useMemo(
    () => sortedTrips.map(ts => ({ ts, pctLeft: ((ts - windowStart) / span) * 100 })),
    [sortedTrips, windowStart, span],
  )

  // Skip to the trip immediately before / after the cursor. If no trip in
  // that direction, no-op (button auto-disables via the `disabled` attr).
  const prevTripTs = useMemo<number | null>(() => {
    for (let i = sortedTrips.length - 1; i >= 0; i--) {
      const t = sortedTrips[i]
      if (t !== undefined && t < cursorTs) return t
    }
    return null
  }, [sortedTrips, cursorTs])
  const nextTripTs = useMemo(() => {
    for (const ts of sortedTrips) {
      if (ts > cursorTs) return ts
    }
    return null
  }, [sortedTrips, cursorTs])

  const onPrevTrip = useCallback(() => {
    if (prevTripTs !== null) onCursorChange(prevTripTs)
  }, [prevTripTs, onCursorChange])
  const onNextTrip = useCallback(() => {
    if (nextTripTs !== null) onCursorChange(nextTripTs)
  }, [nextTripTs, onCursorChange])

  // Tick interval adapts to the window span (#56): a 2h dynamic window gets
  // 30-minute ticks; the full 24h still gets the original 3-hour spacing.
  // See `pickTickInterval` for the breakpoints. Ticks land on the absolute
  // timestamp-space boundary (UTC seconds), not local clock hours — keeps the
  // logic timezone-agnostic at the cost of an occasional off-by-one against
  // the local clock. Acceptable: the cursor label is the authoritative time.
  const ticks = useMemo(() => {
    const offsets: { ts: number; pctLeft: number; label: string }[] = []
    const tickInterval = pickTickInterval(span)
    // Show minutes on the tick labels when the interval is sub-hour, so 15-
    // and 30-minute ticks aren't all labeled with the same hour string.
    const showMinutes = tickInterval < 3600
    const firstTickTs = Math.ceil(windowStart / tickInterval) * tickInterval
    for (let ts = firstTickTs; ts <= windowEnd; ts += tickInterval) {
      const pct = ((ts - windowStart) / span) * 100
      offsets.push({ ts, pctLeft: pct, label: formatTick(ts, timezone, showMinutes) })
    }
    return offsets
  }, [windowStart, windowEnd, span, timezone])

  const onSliderInput = useCallback(
    (ev: React.ChangeEvent<HTMLInputElement>) => {
      const next = Number(ev.target.value)
      if (Number.isFinite(next)) {
        onCursorChange(next)
        trackFlow('scrub')
      }
    },
    [onCursorChange, trackFlow],
  )

  // Jump to "now" (windowEnd). Useful after manually scrubbing back.
  const onJumpToNow = useCallback(() => onCursorChange(windowEnd), [onCursorChange, windowEnd])

  // Click on the track moves the cursor to the clicked position. Lets users
  // scrub to a rough timestamp without dragging the handle precisely.
  const onTrackClick = useCallback(
    (ev: React.MouseEvent<HTMLDivElement>) => {
      const el = trackRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const pct = (ev.clientX - rect.left) / rect.width
      const clamped = Math.max(0, Math.min(1, pct))
      onCursorChange(windowStart + clamped * (windowEnd - windowStart))
      trackFlow('scrub')
    },
    [onCursorChange, windowStart, windowEnd, trackFlow],
  )

  return (
    <Flex
      direction="column"
      gap="xs"
      css={{
        padding: `${theme.spacing.s}px ${theme.spacing.l}px`,
        background: theme.color.background.surface1,
        borderTop: `1px solid ${theme.color.border.default}`,
        '@media (max-width: 600px)': {
          padding: `${theme.spacing.xs}px ${theme.spacing.s}px`,
          borderTop: 'none',
          borderBottom: `1px solid ${theme.color.border.default}`,
        },
      }}
    >
      <Flex alignItems="center" justifyContent="space-between" gap="m" wrap="wrap">
        <Flex alignItems="center" gap="s">
          <button
            type="button"
            onClick={handlePlayToggle}
            aria-label={playing ? 'Pause playback' : 'Play playback'}
            aria-pressed={playing}
            title={`${playing ? 'Pause' : 'Play'} (Space)`}
            data-testid="flow-play-toggle"
            css={{
              all: 'unset',
              cursor: 'pointer',
              width: 36,
              height: 36,
              borderRadius: theme.cornerRadius.s,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: playing ? theme.color.text.heading : theme.color.background.white,
              color: playing ? theme.color.background.surface1 : theme.color.text.heading,
              border: `1px solid ${theme.color.border.default}`,
              transition: `background ${theme.motion.quick}, color ${theme.motion.quick}`,
              '&:hover': { background: theme.color.text.heading, color: theme.color.background.surface1 },
              '&:focus-visible': { outline: `2px solid ${theme.color.focus.default}`, outlineOffset: 1 },
            }}
          >
            {playing ? (
              <svg width={14} height={14} viewBox="0 0 12 12" aria-hidden>
                <rect x={2} y={2} width={3} height={8} fill="currentColor" />
                <rect x={7} y={2} width={3} height={8} fill="currentColor" />
              </svg>
            ) : (
              <svg width={14} height={14} viewBox="0 0 12 12" aria-hidden>
                <path d="M3 2 L10 6 L3 10 Z" fill="currentColor" />
              </svg>
            )}
          </button>
          {poolMode ? (
            <Text variant="title" size="s" strength="strong" color="heading">
              {poolProgress ?? '—'}
            </Text>
          ) : (
            <>
              <button
                type="button"
                onClick={onPrevTrip}
                disabled={prevTripTs === null}
                aria-label="Skip to previous trip"
                title="Previous trip"
                data-testid="flow-prev-trip"
                css={{
                  all: 'unset',
                  cursor: prevTripTs === null ? 'not-allowed' : 'pointer',
                  opacity: prevTripTs === null ? 0.35 : 1,
                  width: 28,
                  height: 28,
                  borderRadius: theme.cornerRadius.s,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: `1px solid ${theme.color.border.default}`,
                  background: theme.color.background.white,
                  color: theme.color.text.default,
                  transition: `background ${theme.motion.quick}`,
                  '&:hover:not(:disabled)': { background: theme.color.background.surface1 },
                  '&:focus-visible': { outline: `2px solid ${theme.color.focus.default}`, outlineOffset: 1 },
                }}
              >
                <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden>
                  <path d="M3 2 L3 8 M7 1 L3 5 L7 9" stroke="currentColor" strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <Text variant="title" size="s" strength="strong" color="heading">
                {formatClock(cursorTs, timezone)}
              </Text>
              <button
                type="button"
                onClick={onNextTrip}
                disabled={nextTripTs === null}
                aria-label="Skip to next trip"
                title="Next trip"
                data-testid="flow-next-trip"
                css={{
                  all: 'unset',
                  cursor: nextTripTs === null ? 'not-allowed' : 'pointer',
                  opacity: nextTripTs === null ? 0.35 : 1,
                  width: 28,
                  height: 28,
                  borderRadius: theme.cornerRadius.s,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: `1px solid ${theme.color.border.default}`,
                  background: theme.color.background.white,
                  color: theme.color.text.default,
                  transition: `background ${theme.motion.quick}`,
                  '&:hover:not(:disabled)': { background: theme.color.background.surface1 },
                  '&:focus-visible': { outline: `2px solid ${theme.color.focus.default}`, outlineOffset: 1 },
                }}
              >
                <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden>
                  <path d="M7 2 L7 8 M3 1 L7 5 L3 9" stroke="currentColor" strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                type="button"
                onClick={onJumpToNow}
                aria-label="Jump to now"
                title="Jump to now"
                data-testid="flow-jump-now"
                css={{
                  all: 'unset',
                  cursor: 'pointer',
                  padding: `${theme.spacing.xs}px ${theme.spacing.s}px`,
                  borderRadius: theme.cornerRadius.s,
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: theme.color.text.subdued,
                  border: `1px solid ${theme.color.border.default}`,
                  background: 'transparent',
                  transition: `color ${theme.motion.quick}, background ${theme.motion.quick}`,
                  '&:hover': { color: theme.color.text.default, background: theme.color.background.white },
                  '&:focus-visible': { outline: `2px solid ${theme.color.focus.default}`, outlineOffset: 1 },
                }}
              >
                Now
              </button>
            </>
          )}
        </Flex>
        {caption && (
          <Text variant="body" size="xs" color="subdued">{caption}</Text>
        )}
      </Flex>

      <div
        ref={trackRef}
        onClick={onTrackClick}
        css={{ position: 'relative', height: poolMode ? 20 : 32, cursor: 'pointer' }}
      >
        {!poolMode && tripMarkers.length > 0 && (
          <div css={{ position: 'absolute', left: 0, right: 0, bottom: 16, height: 8, pointerEvents: 'none' }}>
            {tripMarkers.map((m, i) => (
              <div
                key={`${m.ts}-${i}`}
                css={{
                  position: 'absolute',
                  left: `${m.pctLeft}%`,
                  transform: 'translateX(-50%)',
                  top: 0,
                  bottom: 0,
                  width: 2,
                  background: theme.color.text.heading,
                  opacity: 0.55,
                  borderRadius: 1,
                }}
              />
            ))}
          </div>
        )}

        {!poolMode && (
          <div css={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            {ticks.map(tick => (
              <div
                key={tick.ts}
                data-testid="flow-scrubber-tick"
                css={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: `${tick.pctLeft}%`,
                  transform: 'translateX(-50%)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2,
                }}
              >
                <div css={{
                  width: 1,
                  height: 6,
                  background: theme.color.border.default,
                }} />
                <div css={{
                  fontSize: 10,
                  color: theme.color.text.subdued,
                  whiteSpace: 'nowrap',
                }}>{tick.label}</div>
              </div>
            ))}
          </div>
        )}
        <input
          type="range"
          min={windowStart}
          max={windowEnd}
          step={poolMode ? 0.1 : 60}
          value={cursorTs}
          onChange={onSliderInput}
          aria-label={poolMode ? 'Trip progress' : 'Timeline scrubber'}
          aria-valuemin={windowStart}
          aria-valuemax={windowEnd}
          aria-valuenow={cursorTs}
          data-testid="flow-scrubber"
          css={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 4,
            width: '100%',
            margin: 0,
            accentColor: theme.color.text.heading,
          }}
        />
      </div>
    </Flex>
  )
}
