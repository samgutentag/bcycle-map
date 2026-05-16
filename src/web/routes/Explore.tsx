import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Box,
  Flex,
  IconArrowRotate,
  IconCalendarWeek,
  IconCaretRight,
  Paper,
  Text,
  useTheme,
} from '@audius/harmony'
import { useLiveSnapshot } from '../hooks/useLiveSnapshot'
import SystemTotals from '../components/SystemTotals'
import ActiveRidersOverTime from '../components/ActiveRidersOverTime'
import HourOfWeekHeatmap from '../components/HourOfWeekHeatmap'
import TravelTimeHeatmap from '../components/TravelTimeHeatmap'
import TravelTimeBadge from '../components/TravelTimeBadge'
import StationPicker from '../components/StationPicker'
import ActivityLog from '../components/ActivityLog'
import ChartSkeleton from '../components/ChartSkeleton'
import { useTotalBikesOverTime } from '../hooks/useTotalBikesOverTime'
import { useHourOfWeek } from '../hooks/useHourOfWeek'
import { useHourOfWeekActiveRiders } from '../hooks/useHourOfWeekActiveRiders'
import { useTravelMatrix, lookupTravelTime } from '../hooks/useTravelMatrix'
import { useRouteCache } from '../hooks/useRouteCache'
import { useActivity } from '../hooks/useActivity'
import { useRoutePopularity } from '../hooks/useRoutePopularity'
import PopularStationsTile from '../components/PopularStationsTile'
import PopularRoutesTile from '../components/PopularRoutesTile'
import { resolveRange } from '../lib/date-range'
import TripRouteModal from '../components/TripRouteModal'
import type { Trip } from '@shared/types'

const SYSTEM_ID = 'bcycle_santabarbara'
const API_BASE = import.meta.env.VITE_API_BASE ?? ''
const R2_BASE = import.meta.env.VITE_R2_PUBLIC_URL ?? 'https://pub-83059e704dd64536a5166ab289eb42e5.r2.dev'

function Section({
  title,
  description,
  children,
  trailing,
}: {
  title: string
  description?: string
  children: React.ReactNode
  trailing?: React.ReactNode
}) {
  return (
    <Flex direction="column" gap="s">
      <Flex alignItems="center" justifyContent="space-between" gap="m" wrap="wrap">
        <Text variant="title" size="m" strength="strong" color="heading">{title}</Text>
        {trailing}
      </Flex>
      {description && (
        <Text variant="body" size="xs" color="subdued">{description}</Text>
      )}
      <Paper p="m" borderRadius="m" shadow="near" border="default" direction="column" gap="s">
        {children}
      </Paper>
    </Flex>
  )
}

function HeatmapComingSoon({ cellsCovered }: { cellsCovered: number }) {
  return (
    <div className="relative w-full rounded-md border border-dashed border-line-strong bg-surface-2 flex items-center justify-center" css={{ minHeight: 200 }}>
      <div className="text-center px-6 py-8">
        <div className="text-sm font-semibold text-ink">Coming soon</div>
        <div className="text-xs text-ink-subdued mt-1">
          Hour-of-week patterns need at least 8 days of polling so every day × hour cell has data.
          {' '}
          Currently filled: <strong>{cellsCovered}</strong> of 168 cells.
        </div>
      </div>
    </div>
  )
}

function ErrorBox({ message }: { message: string }) {
  const theme = useTheme()
  return (
    <pre css={{
      padding: 16,
      margin: 0,
      fontSize: 12,
      color: theme.color.text.danger,
      background: theme.color.background.surface1,
      border: `1px solid ${theme.color.border.default}`,
      borderRadius: theme.cornerRadius.s,
      whiteSpace: 'pre-wrap',
    }}>{message}</pre>
  )
}

export default function Explore() {
  const theme = useTheme()
  const navigate = useNavigate()
  const { data: live } = useLiveSnapshot(SYSTEM_ID)
  const matrix = useTravelMatrix(R2_BASE, SYSTEM_ID)
  const popularity = useRoutePopularity(R2_BASE, SYSTEM_ID)
  const routes = useRouteCache(R2_BASE, SYSTEM_ID)
  const activity = useActivity(SYSTEM_ID)
  const [openTrip, setOpenTrip] = useState<Trip | null>(null)
  const [now] = useState(() => Math.floor(Date.now() / 1000))
  // Hour-of-week heatmaps read all history — they're a typical-pattern lens,
  // not a "last N days" snapshot, so a date-range picker added noise without
  // changing the visible bucket fills much.
  const range = useMemo(() => resolveRange('all', now), [now])
  const [routeStart, setRouteStart] = useState<string | null>(null)
  const [routeEnd, setRouteEnd] = useState<string | null>(null)
  const routeEdge = lookupTravelTime(matrix.data, routeStart, routeEnd)
  const swapRoute = () => {
    setRouteStart(routeEnd)
    setRouteEnd(routeStart)
  }

  const timezone = live?.system.timezone
  const maxBikesEver = live?.max_bikes_ever
  // Active riders chart is locked to the last 7 days (independent of the page date-range picker).
  const sevenDayRange = useMemo(() => resolveRange('7d', now), [now])
  const totals = useTotalBikesOverTime({ apiBase: API_BASE, r2Base: R2_BASE, system: SYSTEM_ID, range: sevenDayRange })
  const hourly = useHourOfWeek({ apiBase: API_BASE, r2Base: R2_BASE, system: SYSTEM_ID, range, timezone })
  const riders = useHourOfWeekActiveRiders({
    apiBase: API_BASE, r2Base: R2_BASE, system: SYSTEM_ID, range, timezone, maxBikesEver,
  })

  const bikesHeatmapData = hourly.data?.map(r => ({
    dow: r.dow, hod: r.hod, value: r.avg_bikes, samples: r.samples,
  })) ?? []
  const ridersHeatmapData = riders.data?.map(r => ({
    dow: r.dow, hod: r.hod, value: r.avg_active_riders, samples: r.samples,
  })) ?? []
  // Hour-of-week heatmaps need every (dow, hod) cell populated to read
  // sensibly. After ~7 days of continuous polling every cell has at least
  // one sample. Hide the chart with a "coming soon" placeholder until then.
  const HEATMAP_MIN_CELLS = 168
  const bikesHeatmapReady = hourly.data && bikesHeatmapData.length >= HEATMAP_MIN_CELLS
  const ridersHeatmapReady = riders.data && ridersHeatmapData.length >= HEATMAP_MIN_CELLS

  return (
    <Flex
      direction="column"
      gap="xl"
      css={{
        maxWidth: 1280,
        margin: '0 auto',
        padding: `${theme.spacing.l}px ${theme.spacing.l}px ${theme.spacing['3xl']}px`,
        '@media (max-width: 600px)': {
          padding: `${theme.spacing.m}px ${theme.spacing.s}px ${theme.spacing.xl}px`,
        },
      }}
    >
      <Flex alignItems="flex-end" justifyContent="space-between" gap="m" wrap="wrap">
        <Flex direction="column" gap="xs">
          <Flex alignItems="center" gap="s">
            <IconCalendarWeek size="m" color="subdued" />
            <Text
              variant="display"
              size="s"
              strength="strong"
              color="heading"
              css={{ '@media (max-width: 600px)': { fontSize: 24, lineHeight: '1.2' } }}
            >Explore</Text>
          </Flex>
          <Text variant="body" size="s" color="subdued">
            Historical patterns for the Santa Barbara BCycle system.
          </Text>
        </Flex>
      </Flex>

      {live && (
        <SystemTotals
          stations={live.stations}
          maxBikesEver={live.max_bikes_ever}
          recent24h={live.recent24h}
          timezone={live.system.timezone}
          snapshotTs={live.snapshot_ts}
          lastChangedTs={live.last_total_changed_ts}
          variant="inline"
        />
      )}

      <Section
        title="Activity log"
        description="Recent station-level departures (bike count went down) and arrivals (bike count went up), sampled every two minutes. Inferred trips on the right pair each departure with its most likely matching arrival, scored against the travel-time matrix."
        trailing={
          <Link
            to="/activity"
            css={{
              color: theme.color.text.accent,
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 2,
              '&:hover': { textDecoration: 'underline' },
            }}
          >
            View all <IconCaretRight size="xs" color="accent" />
          </Link>
        }
      >
        {activity.error && <ErrorBox message={activity.error.message} />}
        {!activity.error && (
          <ActivityLog
            log={activity.data}
            stations={live?.stations ?? []}
            matrix={matrix.data}
            timezone={live?.system.timezone}
            maxEvents={20}
            maxTrips={20}
            onTripClick={setOpenTrip}
          />
        )}
      </Section>

      <Section title="Popular stations · 30 days">
        <PopularStationsTile
          top={popularity.data?.topStations ?? []}
          stations={live?.stations.map(s => ({ station_id: s.station_id, name: s.name })) ?? []}
          loading={popularity.loading}
        />
      </Section>

      <Section title="Popular routes · 30 days">
        <PopularRoutesTile
          top={popularity.data?.topRoutes ?? []}
          stations={live?.stations.map(s => ({ station_id: s.station_id, name: s.name })) ?? []}
          loading={popularity.loading}
        />
      </Section>

      <Section
        title="Active riders over time · 7 days"
        description={`Bikes not parked at any station, sampled every two minutes. active_riders = max(0, peak_observed_bikes − parked_bikes), where peak_observed_bikes ≈ fleet size.${maxBikesEver ? ` Current fleet baseline: ${maxBikesEver}.` : ''}`}
      >
        {totals.error && <ErrorBox message={totals.error.message} />}
        {!totals.error && (totals.loading || !totals.data) && (
          <ChartSkeleton aspectRatio={600 / 220} phase={totals.phase} />
        )}
        {!totals.loading && !totals.error && totals.data && (
          <ActiveRidersOverTime data={totals.data} maxBikesEver={maxBikesEver} />
        )}
      </Section>

      <Section
        title="Active riders — hour of week"
        description={`Estimated bikes in use system-wide (max bikes observed minus bikes parked) per day-of-week and hour-of-day. Darker cells = more riders out at that time.${riders.enabled ? '' : ' Available once the poller has captured a peak bikes-parked value to compare against.'}`}
      >
        {!riders.enabled && (
          <Box css={{
            padding: 24,
            textAlign: 'center',
            background: theme.color.background.surface1,
            borderRadius: theme.cornerRadius.s,
            border: `1px dashed ${theme.color.border.default}`,
          }}>
            <Text variant="body" size="s" color="subdued">
              Waiting for a peak bikes-parked observation (usually a 3am idle moment).
            </Text>
          </Box>
        )}
        {riders.enabled && riders.error && <ErrorBox message={riders.error.message} />}
        {riders.enabled && !riders.error && (riders.loading || !riders.data) && (
          <ChartSkeleton aspectRatio={(32 + 22 * 24) / (16 + 22 * 7)} phase={riders.phase} />
        )}
        {riders.enabled && !riders.loading && !riders.error && riders.data && !ridersHeatmapReady && (
          <HeatmapComingSoon cellsCovered={ridersHeatmapData.length} />
        )}
        {riders.enabled && !riders.loading && !riders.error && riders.data && ridersHeatmapReady && (
          <HourOfWeekHeatmap data={ridersHeatmapData} scheme="riders" unit="riders" />
        )}
      </Section>

      <Section
        title="Available bikes — hour of week"
        description={`Average bikes parked across the system, broken down by day-of-week (rows) and hour-of-day (columns${timezone ? `, ${timezone}` : ''}). Darker cells mean more bikes parked; lighter cells mean bikes are out being ridden.`}
      >
        {hourly.error && <ErrorBox message={hourly.error.message} />}
        {!hourly.error && (hourly.loading || !hourly.data) && (
          <ChartSkeleton aspectRatio={(32 + 22 * 24) / (16 + 22 * 7)} phase={hourly.phase} />
        )}
        {!hourly.loading && !hourly.error && hourly.data && !bikesHeatmapReady && (
          <HeatmapComingSoon cellsCovered={bikesHeatmapData.length} />
        )}
        {!hourly.loading && !hourly.error && hourly.data && bikesHeatmapReady && (
          <HourOfWeekHeatmap data={bikesHeatmapData} scheme="bikes" unit="bikes" />
        )}
      </Section>

      <Section
        title="Travel-time matrix"
        description="Bike-route minutes between every pair of stations, via Google Distance Matrix. Pick an origin and a destination to outline the row and column — they cross at the travel time for that pair. Darker cells = longer rides."
      >
        {matrix.error && <ErrorBox message={matrix.error.message} />}
        {!matrix.error && matrix.loading && <ChartSkeleton aspectRatio={1} />}
        {!matrix.error && !matrix.loading && matrix.data && live && (
          <>
            <Box css={{
              display: 'grid',
              gridTemplateColumns: '1fr auto 1fr',
              alignItems: 'flex-end',
              gap: theme.spacing.s,
              marginBottom: theme.spacing.s,
              '@media (max-width: 600px)': { gridTemplateColumns: '1fr' },
            }}>
              <StationPicker label="Origin" value={routeStart} stations={live.stations} onChange={setRouteStart} />
              <button
                type="button"
                onClick={swapRoute}
                disabled={!routeStart && !routeEnd}
                aria-label="Reverse route (swap origin and destination)"
                title="Reverse route"
                css={{
                  all: 'unset',
                  cursor: 'pointer',
                  alignSelf: 'flex-end',
                  marginBottom: 4,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: `${theme.spacing.xs}px ${theme.spacing.s}px`,
                  borderRadius: theme.cornerRadius.s,
                  border: `1px solid ${theme.color.border.default}`,
                  background: theme.color.background.white,
                  color: theme.color.text.default,
                  transition: `background ${theme.motion.quick}`,
                  '&:hover:not(:disabled)': { background: theme.color.background.surface1 },
                  '&:disabled': { opacity: 0.4, cursor: 'not-allowed' },
                  '&:focus-visible': { outline: `2px solid ${theme.color.focus.default}`, outlineOffset: 1 },
                }}
              >
                <IconArrowRotate size="s" color="subdued" />
              </button>
              <StationPicker label="Destination" value={routeEnd} stations={live.stations} onChange={setRouteEnd} />
            </Box>
            {(routeStart || routeEnd) && (
              <TravelTimeBadge minutes={routeEdge?.minutes ?? null} meters={routeEdge?.meters ?? null} />
            )}
            <TravelTimeHeatmap
              matrix={matrix.data}
              stations={live.stations}
              selectedStartId={routeStart}
              selectedEndId={routeEnd}
              onPickPair={(fromId, toId) => navigate(`/route/${fromId}/${toId}`)}
            />
            <Text variant="body" size="xs" color="subdued" css={{ marginTop: theme.spacing.xs }}>
              Click any cell to open that pair in the route planner.
            </Text>
          </>
        )}
      </Section>

      {openTrip && (
        <TripRouteModal
          trip={openTrip}
          stations={live?.stations ?? []}
          matrix={matrix.data}
          routes={routes.data}
          systemTz={live?.system.timezone ?? 'UTC'}
          onClose={() => setOpenTrip(null)}
        />
      )}
    </Flex>
  )
}
