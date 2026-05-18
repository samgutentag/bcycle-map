import { useEffect, useMemo, useRef, useState } from 'react'
import { Flex, Text, useTheme } from '@audius/harmony'
import { keyframes } from '@emotion/react'
import type { KVValue, StationSnapshot } from '@shared/types'
import { diffSnapshots } from '../lib/pin-pulse'
import { formatRelative } from '../lib/relative-time'

type Props = {
  /** Live snapshot from useLiveSnapshot. Drives both the diff and the "ago" clock. */
  data: KVValue | null
  /** Max stations to enumerate in the tooltip before collapsing to "+N more". */
  tooltipCap?: number
  /** Test seam — override the prefers-reduced-motion detection. */
  reducedMotion?: boolean
}

// Brief background + scale flash. Stays subtle so it reads as a heartbeat,
// not an alert. Duration kept under 1s per the spec.
const flashKeyframes = keyframes`
  0%   { transform: scale(1);    box-shadow: 0 0 0 0 rgba(13, 108, 176, 0.45); }
  20%  { transform: scale(1.05); box-shadow: 0 0 0 6px rgba(13, 108, 176, 0.18); }
  100% { transform: scale(1);    box-shadow: 0 0 0 0 rgba(13, 108, 176, 0); }
`

const FLASH_DURATION_MS = 900
const TOOLTIP_DEFAULT_CAP = 10

function detectReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

type FlashState = {
  count: number
  names: string[]
  totalChanged: number
  at: number  // ms epoch
}

/**
 * Top-left chip that pulses each time the poller delivers a fresh snapshot.
 *
 * Resting state: "Updated 42s ago".
 * On a new tick: briefly flashes (≤1s) and swaps to "N stations changed" or
 * "No changes". After the flash, settles back to the resting "ago" string.
 *
 * Distinct from `StalenessBadge` — staleness signals "data is old", this
 * signals "a fresh tick just landed". Different placement and shape so the
 * two never feel like they're saying the same thing.
 */
export default function PollPinger({ data, tooltipCap = TOOLTIP_DEFAULT_CAP, reducedMotion }: Props) {
  const theme = useTheme()

  // Diff baseline. Held in a ref so a re-render that doesn't change `data`
  // (e.g. the 1s "ago" tick below) doesn't re-trigger the flash.
  const prevStationsRef = useRef<StationSnapshot[] | null>(null)
  const [flash, setFlash] = useState<FlashState | null>(null)
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000))
  const [hovering, setHovering] = useState(false)

  // Lightweight clock so the "ago" text updates between polls.
  useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(id)
  }, [])

  // When a new snapshot lands, diff it against the prior snapshot, build a
  // flash payload (count + name list for tooltip), and set it.
  useEffect(() => {
    if (!data) return
    const prev = prevStationsRef.current
    prevStationsRef.current = data.stations
    if (!prev) return  // first tick: just record baseline, no flash

    const events = diffSnapshots(prev, data.stations)
    const namesById = new Map(data.stations.map(s => [s.station_id, s.name]))
    const names = events
      .map(e => namesById.get(e.stationId) ?? e.stationId)
      .sort((a, b) => a.localeCompare(b))

    setFlash({
      count: events.length,
      names,
      totalChanged: events.length,
      at: Date.now(),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  // Tear down the flash after its window expires so the chip reverts to
  // showing the "ago" string.
  useEffect(() => {
    if (!flash) return
    const id = setTimeout(() => setFlash(null), FLASH_DURATION_MS + 200)
    return () => clearTimeout(id)
  }, [flash])

  const reduce = reducedMotion ?? detectReducedMotion()

  const restingText = data ? `Updated ${formatRelative(data.snapshot_ts, nowSec)}` : 'Waiting for first poll…'

  const showFlash = flash !== null
  const flashLabel = flash
    ? flash.count === 0
      ? 'No changes'
      : `${flash.count} ${flash.count === 1 ? 'station' : 'stations'} changed`
    : null

  const visibleNames = useMemo(() => (flash ? flash.names.slice(0, tooltipCap) : []), [flash, tooltipCap])
  const overflow = flash ? Math.max(0, flash.totalChanged - tooltipCap) : 0

  // Tooltip is only meaningful when we have changed-station context. Hide it
  // on the resting "ago" view to keep the chip from being noisy.
  const tooltipVisible = hovering && flash !== null && flash.count > 0

  return (
    <div
      css={{ position: 'absolute', top: 16, left: 16, zIndex: 10 }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocus={() => setHovering(true)}
      onBlur={() => setHovering(false)}
    >
      <Flex
        alignItems="center"
        gap="xs"
        data-testid="poll-pinger"
        data-flashing={showFlash ? 'true' : 'false'}
        aria-live="polite"
        css={{
          padding: `${theme.spacing.xs}px ${theme.spacing.s}px`,
          // Distinct shape from the staleness badge (which uses cornerRadius.s
          // = small radius). Full pill here so the two never read as siblings.
          borderRadius: 9999,
          background: `color-mix(in srgb, ${theme.color.background.white} 92%, transparent)`,
          backdropFilter: 'saturate(160%) blur(8px)',
          color: theme.color.text.default,
          boxShadow: theme.shadows.near,
          border: `1px solid ${theme.color.border.default}`,
          cursor: tooltipVisible ? 'help' : 'default',
          // Apply the keyframe only when (a) a flash is active and (b) the
          // user hasn't asked for reduced motion. In reduced-motion mode the
          // chip still swaps text — just no animation.
          animation: showFlash && !reduce ? `${flashKeyframes} ${FLASH_DURATION_MS}ms ease-out` : 'none',
        }}
        tabIndex={0}
      >
        <span
          aria-hidden="true"
          css={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: showFlash
              ? (flash && flash.count > 0 ? theme.color.background.accent : theme.color.text.subdued)
              : theme.color.text.subdued,
            transition: `background ${theme.motion.quick}`,
          }}
        />
        <Text variant="label" size="xs" strength="strong" color="default">
          {showFlash ? flashLabel : restingText}
        </Text>
      </Flex>
      {tooltipVisible && (
        <div
          role="tooltip"
          data-testid="poll-pinger-tooltip"
          css={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 6,
            padding: `${theme.spacing.s}px ${theme.spacing.m}px`,
            background: theme.color.background.white,
            border: `1px solid ${theme.color.border.default}`,
            borderRadius: theme.cornerRadius.s,
            boxShadow: theme.shadows.mid,
            minWidth: 220,
            maxWidth: 320,
            zIndex: 20,
          }}
        >
          <Text variant="label" size="xs" color="subdued" strength="strong" textTransform="uppercase">
            Changed this tick
          </Text>
          <ul css={{ margin: `${theme.spacing.xs}px 0 0`, padding: 0, listStyle: 'none' }}>
            {visibleNames.map((n, i) => (
              <li
                key={`${n}-${i}`}
                css={{
                  fontSize: 12,
                  color: theme.color.text.default,
                  padding: '2px 0',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={n}
              >
                {n}
              </li>
            ))}
          </ul>
          {overflow > 0 && (
            <Text variant="label" size="xs" color="subdued">
              +{overflow} more
            </Text>
          )}
        </div>
      )}
    </div>
  )
}
