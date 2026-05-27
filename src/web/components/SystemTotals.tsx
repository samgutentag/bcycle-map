import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Flex, Paper, Text, useTheme } from '@audius/harmony'
import type { ActivityEvent, HourBikeStats, StationSnapshot } from '@shared/types'
import MiniLine from './MiniLine'
import LiveDot from './LiveDot'
import { formatRelative } from '../lib/relative-time'

type Props = {
  stations: StationSnapshot[]
  /** Running max of sum(num_bikes_available) — approximates fleet size. */
  maxBikesEver?: number
  /** Rolling 24-hour per-hour bikes-available min/max from the poller. */
  recent24h?: HourBikeStats[]
  /** IANA timezone for sparkline hover labels. Falls back to browser local. */
  timezone?: string
  /** Unix seconds of the most recent poll. Drives the "checked Xm ago" badge. */
  snapshotTs?: number
  /** Unix seconds of the most recent system-wide bike count change. */
  lastChangedTs?: number
  variant?: 'overlay' | 'inline'
  /**
   * Recent activity events to render as a compact list inside the card.
   * When provided, the latest `recentActivityLimit` events render below the
   * snapshot timestamps with a "view more →" link to /activity. Pass the
   * full event list here; the component slices to its own limit.
   */
  recentEvents?: ActivityEvent[]
  /** Cap on how many events to render in the inline activity section. */
  recentActivityLimit?: number
}

const BIKES_COLOR = '#0d6cb0'
const ACTIVE_COLOR = '#ea580c'

export function computeTotals(stations: StationSnapshot[]) {
  const base = stations.reduce(
    (acc, s) => ({
      bikes: acc.bikes + s.num_bikes_available,
      docks: acc.docks + s.num_docks_available,
      stationsOnline: acc.stationsOnline + (s.is_installed && s.is_renting ? 1 : 0),
    }),
    { bikes: 0, docks: 0, stationsOnline: 0 },
  )
  return { ...base, totalDockSlots: base.bikes + base.docks }
}

function formatHourLabel(hourTsSec: number, tz?: string): string {
  return new Date(hourTsSec * 1000).toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    timeZone: tz,
  })
}

export default function SystemTotals({
  stations,
  maxBikesEver,
  recent24h,
  timezone,
  snapshotTs,
  lastChangedTs,
  variant = 'overlay',
  recentEvents,
  recentActivityLimit = 5,
}: Props) {
  const theme = useTheme()
  const totals = computeTotals(stations)
  const showBikeMax = typeof maxBikesEver === 'number' && maxBikesEver > 0
  const activeRiders = showBikeMax ? Math.max(0, (maxBikesEver as number) - totals.bikes) : null

  // Pre-sliced event list — most recent first, capped at the limit. Events are
  // already stored newest-first by the poller, but we sort defensively in case
  // a future caller passes them in a different order.
  const visibleEvents = useMemo(() => {
    if (!recentEvents || recentEvents.length === 0) return []
    return [...recentEvents].sort((a, b) => b.ts - a.ts).slice(0, recentActivityLimit)
  }, [recentEvents, recentActivityLimit])

  // Resolve station ids to display names so the inline activity rows don't
  // surface raw ids. Falls back to the id if the station isn't in the
  // current snapshot (rare — happens if a station drops out between the
  // event landing and the snapshot refresh).
  const stationNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of stations) m.set(s.station_id, s.name)
    return m
  }, [stations])

  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 10_000)
    return () => clearInterval(id)
  }, [])

  const sorted = (recent24h ?? []).slice().sort((a, b) => a.hour_ts - b.hour_ts)
  const bikesSeries = sorted.map(h => h.bikes_max)
  const activeSeries = showBikeMax ? sorted.map(h => Math.max(0, (maxBikesEver as number) - h.bikes_min)) : []

  const [hover, setHover] = useState<{ series: 'bikes' | 'active'; index: number } | null>(null)
  const hoveredHour = hover ? sorted[hover.index] : null
  const hoveredBikesVal = hover?.series === 'bikes' && hoveredHour ? bikesSeries[hover.index] : null
  const hoveredActiveVal = hover?.series === 'active' && hoveredHour ? activeSeries[hover.index] : null
  const hoveredLabel = hoveredHour ? formatHourLabel(hoveredHour.hour_ts, timezone) : null

  const [activityExpanded, setActivityExpanded] = useState(false)
  const toggleActivity = useCallback(() => setActivityExpanded(p => !p), [])

  const overlayCss =
    variant === 'overlay'
      ? {
          position: 'absolute' as const,
          top: 16,
          right: 16,
          minWidth: 280,
          maxWidth: 340,
          overflow: 'hidden',
          backdropFilter: 'saturate(160%) blur(8px)',
          background: `color-mix(in srgb, ${theme.color.background.white} 92%, transparent)`,
          '@media (max-width: 600px)': {
            top: 8,
            right: 8,
            left: 8,
            minWidth: 0,
            maxWidth: 'none',
            maxHeight: 'none',
            overflow: 'visible',
          },
        }
      : { background: theme.color.background.white }

  return (
    <Paper
      p="m"
      borderRadius="m"
      shadow={variant === 'overlay' ? 'far' : 'near'}
      border="default"
      direction="column"
      gap="s"
      css={overlayCss}
    >
      <Flex alignItems="center" gap="xs">
        <LiveDot />
        <Text variant="label" size="xs" strength="strong" color="active" textTransform="uppercase">
          {snapshotTs != null ? `Updated ${formatRelative(snapshotTs, nowSec)}` : 'Live'}
        </Text>
      </Flex>

      <Flex
        gap="xl"
        alignItems="flex-end"
        justifyContent={variant === 'inline' ? 'center' : 'flex-start'}
        css={
          variant === 'inline'
            ? {
                // Constrain the two stat columns to the middle third of the
                // inline card — they're a small amount of data and reading
                // across a full-width row looked stretched.
                maxWidth: 'calc(100% / 3)',
                margin: '0 auto',
                minWidth: 280,
              }
            : undefined
        }
      >
        {activeRiders !== null && (
          <Flex direction="column" gap="2xs" css={{ minWidth: 130 }}>
            <Text
              variant="display"
              size="s"
              strength="strong"
              color="warning"
              title="Bikes not parked at any station — riders out using them right now."
            >
              {activeRiders}
            </Text>
            <Text variant="label" size="xs" color="subdued" css={{ height: 16, whiteSpace: 'nowrap' }}>
              {hoveredActiveVal != null ? `peak ${hoveredActiveVal} · ${hoveredLabel}` : 'active riders'}
            </Text>
            <MiniLine
              values={activeSeries}
              color={ACTIVE_COLOR}
              hoverIndex={hover?.series === 'active' ? hover.index : null}
              onHoverIndexChange={i => setHover(i === null ? null : { series: 'active', index: i })}
            />
          </Flex>
        )}
        <Flex direction="column" gap="2xs" css={{ minWidth: 130 }}>
          <Flex alignItems="baseline" gap="2xs">
            <Text variant="display" size="s" strength="strong" color="heading">
              {totals.bikes}
            </Text>
            {showBikeMax && (
              <Text
                variant="title"
                size="s"
                color="subdued"
                title="Running max of bikes parked across the system — approximates fleet size."
              >
                / {maxBikesEver}
              </Text>
            )}
          </Flex>
          <Text variant="label" size="xs" color="subdued" css={{ height: 16, whiteSpace: 'nowrap' }}>
            {hoveredBikesVal != null ? `peak ${hoveredBikesVal} · ${hoveredLabel}` : 'bikes available'}
          </Text>
          <MiniLine
            values={bikesSeries}
            color={BIKES_COLOR}
            hoverIndex={hover?.series === 'bikes' ? hover.index : null}
            onHoverIndexChange={i => setHover(i === null ? null : { series: 'bikes', index: i })}
          />
        </Flex>
      </Flex>

      {visibleEvents.length > 0 && (
        <Flex
          direction="column"
          gap="xs"
          css={{
            paddingTop: theme.spacing.xs,
            borderTop: `1px solid ${theme.color.border.default}`,
          }}
          data-testid="system-totals-recent-activity"
        >
          <Flex alignItems="center" justifyContent="space-between">
            <button
              type="button"
              onClick={toggleActivity}
              css={{
                all: 'unset',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                '@media (min-width: 601px)': { display: 'none' },
              }}
            >
              <Text variant="label" size="xs" strength="strong" color="subdued" textTransform="uppercase">
                Recent activity
              </Text>
              <span css={{
                fontSize: 10,
                color: theme.color.text.subdued,
                transition: 'transform 150ms',
                transform: activityExpanded ? 'rotate(180deg)' : 'rotate(0)',
              }}>
                ▼
              </span>
            </button>
            <Text
              variant="label"
              size="xs"
              strength="strong"
              color="subdued"
              textTransform="uppercase"
              css={{ '@media (max-width: 600px)': { display: 'none' } }}
            >
              Recent activity
            </Text>
            <Link
              to="/activity"
              css={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.02em',
                textTransform: 'uppercase',
                color: theme.color.text.subdued,
                textDecoration: 'none',
                '&:hover': { color: theme.color.text.default, textDecoration: 'underline' },
              }}
            >
              View more →
            </Link>
          </Flex>
          <Flex
            direction="column"
            gap="2xs"
            as="ul"
            css={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              '@media (max-width: 600px)': {
                display: activityExpanded ? 'flex' : 'none',
              },
            }}
          >
            {visibleEvents.map(ev => {
              const isOut = ev.type === 'departure'
              const name = stationNameById.get(ev.station_id) ?? ev.station_id
              const deltaSuffix = ev.delta > 1 ? ` ×${ev.delta}` : ''
              return (
                <Flex
                  as="li"
                  key={`${ev.ts}|${ev.station_id}|${ev.type}`}
                  alignItems="center"
                  gap="xs"
                  css={{ fontSize: 12, lineHeight: 1.3 }}
                >
                  <Text
                    variant="label"
                    size="xs"
                    strength="strong"
                    css={{
                      color: isOut ? ACTIVE_COLOR : '#059669',
                      width: 12,
                      flexShrink: 0,
                    }}
                    aria-label={isOut ? 'departure' : 'arrival'}
                  >
                    {isOut ? '↑' : '↓'}
                  </Text>
                  <Link
                    to={`/station/${ev.station_id}/details`}
                    css={{
                      flex: 1,
                      minWidth: 0,
                      color: theme.color.text.default,
                      textDecoration: 'none',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      '&:hover': { textDecoration: 'underline' },
                    }}
                    title={name + deltaSuffix}
                  >
                    {name}{deltaSuffix}
                  </Link>
                  <Text
                    variant="body"
                    size="xs"
                    color="subdued"
                    css={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}
                  >
                    {formatRelative(ev.ts, nowSec)}
                  </Text>
                </Flex>
              )
            })}
          </Flex>
        </Flex>
      )}
    </Paper>
  )
}
