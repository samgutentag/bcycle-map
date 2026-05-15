import { useEffect, useState } from 'react'
import { Flex, Paper, Text, useTheme } from '@audius/harmony'
import type { HourBikeStats, StationSnapshot } from '@shared/types'
import MiniLine from './MiniLine'
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
}: Props) {
  const theme = useTheme()
  const totals = computeTotals(stations)
  const showBikeMax = typeof maxBikesEver === 'number' && maxBikesEver > 0
  const activeRiders = showBikeMax ? Math.max(0, (maxBikesEver as number) - totals.bikes) : null

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

  const overlayCss =
    variant === 'overlay'
      ? {
          position: 'absolute' as const,
          bottom: 56,
          right: 16,
          minWidth: 280,
          backdropFilter: 'saturate(160%) blur(8px)',
          background: `color-mix(in srgb, ${theme.color.background.white} 92%, transparent)`,
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
        <span
          aria-hidden
          css={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: theme.color.status.success,
            boxShadow: `0 0 0 2px color-mix(in srgb, ${theme.color.status.success} 30%, transparent)`,
            animation: 'pulseDot 2s ease-out infinite',
            '@keyframes pulseDot': {
              '0%, 100%': { opacity: 1 },
              '50%': { opacity: 0.4 },
            },
          }}
        />
        <Text variant="label" size="xs" strength="strong" color="active" textTransform="uppercase">
          Right now
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

      <Flex
        alignItems="center"
        gap="m"
        wrap="wrap"
        css={{
          paddingTop: theme.spacing.xs,
          borderTop: `1px solid ${theme.color.border.default}`,
        }}
      >
        {snapshotTs != null && (
          <Text
            variant="body"
            size="xs"
            color="subdued"
            title={`Last poll: ${new Date(snapshotTs * 1000).toLocaleString(undefined, { timeZone: timezone })}`}
          >
            checked {formatRelative(snapshotTs, nowSec)}
          </Text>
        )}
        {lastChangedTs != null && (
          <Text
            variant="body"
            size="xs"
            color="subdued"
            title={`Bike count last changed: ${new Date(lastChangedTs * 1000).toLocaleString(undefined, { timeZone: timezone })}`}
          >
            changed {formatRelative(lastChangedTs, nowSec)}
          </Text>
        )}
      </Flex>
    </Paper>
  )
}
