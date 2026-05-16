import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Box,
  Flex,
  IconArrowRotate,
  Paper,
  Text,
  useTheme,
} from '@audius/harmony'
import { IconBike } from '../components/icons'
import { useLiveSnapshot } from '../hooks/useLiveSnapshot'
import { useStationOverTime } from '../hooks/useStationOverTime'
import { useTravelMatrix, lookupTravelTime } from '../hooks/useTravelMatrix'
import { useRoutePopularity } from '../hooks/useRoutePopularity'
import { lookupPairStat } from '@shared/popularity'
import DateRangePicker from '../components/DateRangePicker'
import StationPicker from '../components/StationPicker'
import StationOverTimeChart from '../components/StationOverTimeChart'
import TravelTimeBadge from '../components/TravelTimeBadge'
import AvgTripDurationBadge from '../components/AvgTripDurationBadge'
import ChartSkeleton from '../components/ChartSkeleton'
import { resolveRange, type Preset } from '../lib/date-range'

const SYSTEM_ID = 'bcycle_santabarbara'
const API_BASE = import.meta.env.VITE_API_BASE ?? ''
const R2_BASE = import.meta.env.VITE_R2_PUBLIC_URL ?? 'https://pub-83059e704dd64536a5166ab289eb42e5.r2.dev'

type HoverState = { source: 'start' | 'dest'; timeSec: number }

function formatClockTime(tsSec: number, tz?: string): string {
  return new Date(tsSec * 1000).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz,
  })
}

export default function RouteCheck() {
  const theme = useTheme()
  const { startId, endId } = useParams<{ startId?: string; endId?: string }>()
  const navigate = useNavigate()
  const { data: live } = useLiveSnapshot(SYSTEM_ID)
  const matrix = useTravelMatrix(R2_BASE, SYSTEM_ID)
  const popularity = useRoutePopularity(R2_BASE, SYSTEM_ID)
  const [preset, setPreset] = useState<Preset>('24h')
  const [now] = useState(() => Math.floor(Date.now() / 1000))
  const range = useMemo(() => resolveRange(preset, now), [preset, now])
  const [hover, setHover] = useState<HoverState | null>(null)

  const [nowTick, setNowTick] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = setInterval(() => setNowTick(Math.floor(Date.now() / 1000)), 60_000)
    return () => clearInterval(id)
  }, [])

  const start = useStationOverTime({
    apiBase: API_BASE, r2Base: R2_BASE, system: SYSTEM_ID, stationId: startId ?? null, range,
  })
  const dest = useStationOverTime({
    apiBase: API_BASE, r2Base: R2_BASE, system: SYSTEM_ID, stationId: endId ?? null, range,
  })

  function setStart(id: string | null) {
    if (id && endId) navigate(`/route/${id}/${endId}`)
    else if (id) navigate(`/route/${id}`)
    else if (endId) navigate(`/route//${endId}`)
    else navigate('/route')
  }
  function setEnd(id: string | null) {
    if (startId && id) navigate(`/route/${startId}/${id}`)
    else if (id) navigate(`/route//${id}`)
    else if (startId) navigate(`/route/${startId}`)
    else navigate('/route')
  }
  function swapEnds() {
    if (startId && endId) navigate(`/route/${endId}/${startId}`)
    else if (startId) navigate(`/route//${startId}`)
    else if (endId) navigate(`/route/${endId}`)
  }

  const stations = live?.stations ?? []
  const timezone = live?.system.timezone
  const startStation = stations.find(s => s.station_id === startId)
  const destStation = stations.find(s => s.station_id === endId)
  const startTotal = startStation ? startStation.num_bikes_available + startStation.num_docks_available : undefined
  const destTotal = destStation ? destStation.num_bikes_available + destStation.num_docks_available : undefined

  const edge = lookupTravelTime(matrix.data, startId, endId)
  const travelTimeSec = edge ? edge.minutes * 60 : null

  const startExternalGuide = hover?.source === 'dest' && travelTimeSec ? hover.timeSec - travelTimeSec : null
  const destExternalGuide = hover?.source === 'start' && travelTimeSec ? hover.timeSec + travelTimeSec : null
  const startGuideLabel = startExternalGuide != null ? `leave ${formatClockTime(startExternalGuide, timezone)}` : undefined
  const destGuideLabel = destExternalGuide != null ? `arrive ${formatClockTime(destExternalGuide, timezone)}` : undefined

  const startPinnedTime = nowTick
  const startPinnedLabel = 'now'
  const destPinnedTime = travelTimeSec ? nowTick + travelTimeSec : nowTick
  const destPinnedLabel = travelTimeSec ? `arrive ${formatClockTime(nowTick + travelTimeSec, timezone)}` : 'now'

  const handleHover = (source: 'start' | 'dest') => (ts: number | null) => {
    if (ts === null) setHover(prev => (prev?.source === source ? null : prev))
    else setHover({ source, timeSec: ts })
  }

  const errCss = {
    padding: 16, margin: 0, fontSize: 12,
    color: theme.color.text.danger,
    background: theme.color.background.surface1,
    border: `1px solid ${theme.color.border.default}`,
    borderRadius: theme.cornerRadius.s,
    whiteSpace: 'pre-wrap' as const,
  }

  return (
    <Flex
      direction="column"
      gap="l"
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
            <IconBike size="m" color="subdued" />
            <Text
              variant="display"
              size="s"
              strength="strong"
              color="heading"
              css={{ '@media (max-width: 600px)': { fontSize: 24, lineHeight: '1.2' } }}
            >Route check</Text>
          </Flex>
          <Text variant="body" size="s" color="subdued">
            Pick a start and a destination. Hover either chart to see the matching time on the other,
            offset by your bike-ride duration.
          </Text>
        </Flex>
        <DateRangePicker value={preset} onChange={setPreset} />
      </Flex>

      <Box css={{
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'flex-end',
        gap: theme.spacing.s,
        '@media (max-width: 600px)': { gridTemplateColumns: '1fr' },
      }}>
        <StationPicker label="Start" value={startId ?? null} stations={stations} onChange={setStart} />
        <button
          type="button"
          onClick={swapEnds}
          disabled={!startId && !endId}
          aria-label="Reverse route (swap start and destination)"
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
        <StationPicker label="Destination" value={endId ?? null} stations={stations} onChange={setEnd} />
      </Box>

      <Paper p="m" borderRadius="m" shadow="near" border="default" direction="column" gap="s">
        <Text variant="title" size="s" strength="strong" color="heading">
          Start: {startStation?.name ?? <Text tag="span" color="subdued">(no station selected)</Text>}
        </Text>
        <Text variant="body" size="xs" color="subdued">
          Bikes available at the start station over the selected range. Higher line = easier to find one to grab.
        </Text>
        {!startId && <Text variant="body" size="s" color="subdued">Pick a start station above to see its trends.</Text>}
        {startId && start.error && <pre css={errCss}>{start.error.message}</pre>}
        {startId && !start.error && (start.loading || !start.data) && (
          <ChartSkeleton aspectRatio={600 / 200} phase={start.phase} />
        )}
        {startId && start.data && !start.loading && (
          <StationOverTimeChart
            data={start.data}
            totalDocks={startTotal}
            show="bikes"
            externalGuideTimeSec={startExternalGuide}
            externalGuideLabel={startGuideLabel}
            pinnedGuideTimeSec={startPinnedTime}
            pinnedGuideLabel={startPinnedLabel}
            onHoverTimeChange={handleHover('start')}
            timezone={timezone}
          />
        )}
      </Paper>

      <TravelTimeBadge
        loading={matrix.loading && !!startId && !!endId}
        minutes={edge?.minutes ?? null}
        meters={edge?.meters ?? null}
        departureTimeSec={edge ? nowTick : null}
        timezone={timezone}
      />
      <AvgTripDurationBadge
        count={lookupPairStat(popularity.data, startId, endId)?.count ?? null}
        meanSec={lookupPairStat(popularity.data, startId, endId)?.mean_sec ?? null}
      />

      <Paper p="m" borderRadius="m" shadow="near" border="default" direction="column" gap="s">
        <Text variant="title" size="s" strength="strong" color="heading">
          Destination: {destStation?.name ?? <Text tag="span" color="subdued">(no station selected)</Text>}
        </Text>
        <Text variant="body" size="xs" color="subdued">
          Open docks at the destination station. Higher line = easier to find a parking spot when you arrive.
        </Text>
        {!endId && <Text variant="body" size="s" color="subdued">Pick a destination above to see its trends.</Text>}
        {endId && dest.error && <pre css={errCss}>{dest.error.message}</pre>}
        {endId && !dest.error && (dest.loading || !dest.data) && (
          <ChartSkeleton aspectRatio={600 / 200} phase={dest.phase} />
        )}
        {endId && dest.data && !dest.loading && (
          <StationOverTimeChart
            data={dest.data}
            totalDocks={destTotal}
            show="docks"
            externalGuideTimeSec={destExternalGuide}
            externalGuideLabel={destGuideLabel}
            pinnedGuideTimeSec={destPinnedTime}
            pinnedGuideLabel={destPinnedLabel}
            onHoverTimeChange={handleHover('dest')}
            timezone={timezone}
          />
        )}
      </Paper>

      <Text variant="body" size="xs" color="subdued">
        Tip: the URL stays in sync with your selections. Bookmark{' '}
        <code css={{
          background: theme.color.background.surface1,
          padding: '1px 6px',
          borderRadius: theme.cornerRadius.xs,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 11,
        }}>/route/&lt;start&gt;/&lt;destination&gt;</code>{' '}
        to come back to a specific pair.
      </Text>
    </Flex>
  )
}
