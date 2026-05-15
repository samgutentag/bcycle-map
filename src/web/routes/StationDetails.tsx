import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import maplibregl, { Map as MlMap, Marker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  Box,
  Flex,
  Hint,
  IconArrowLeft,
  IconCalendarDay,
  IconCaretRight,
  IconExternalLink,
  IconInfo,
  Paper,
  Tag,
  Text,
  useTheme,
} from '@audius/harmony'
import { useLiveSnapshot } from '../hooks/useLiveSnapshot'
import { useStationOverTime } from '../hooks/useStationOverTime'
import DateRangePicker from '../components/DateRangePicker'
import StationOverTimeChart from '../components/StationOverTimeChart'
import MiniLine from '../components/MiniLine'
import ChartSkeleton from '../components/ChartSkeleton'
import ActivityLog from '../components/ActivityLog'
import { useActivity } from '../hooks/useActivity'
import { useTravelMatrix } from '../hooks/useTravelMatrix'
import { useRouteCache } from '../hooks/useRouteCache'
import { resolveRange, type Preset } from '../lib/date-range'
import TripRouteModal from '../components/TripRouteModal'
import type { Trip } from '@shared/types'
import { buildPinSVG, pinSize } from '../lib/pin-svg'
import type { StationSnapshot } from '@shared/types'

const SYSTEM_ID = 'bcycle_santabarbara'
const API_BASE = import.meta.env.VITE_API_BASE ?? ''
const R2_BASE = import.meta.env.VITE_R2_PUBLIC_URL ?? 'https://pub-83059e704dd64536a5166ab289eb42e5.r2.dev'
const POSITRON_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'

type HourBucket = { hour: number; bikes: number; docks: number; samples: number }

type TypicalProfile = {
  stationId: string
  hours: HourBucket[]
  currentHour: number
  currentDow: number
  daysCovered: number
  isDowFiltered: boolean
  label: string
  timezone: string
}

async function fetchStationTypical(
  apiBase: string,
  systemId: string,
  stationId: string,
): Promise<TypicalProfile> {
  const res = await fetch(
    `${apiBase}/api/systems/${encodeURIComponent(systemId)}/stations/${encodeURIComponent(stationId)}/recent`,
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as TypicalProfile
}

function haversineMiles(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 3958.7613
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLon = toRad(bLon - aLon)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function formatDistance(miles: number): string {
  if (miles < 0.1) return `${Math.round(miles * 5280)} ft`
  return `${miles.toFixed(1)} mi`
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'} ago`
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60)
    return `${m} minute${m === 1 ? '' : 's'} ago`
  }
  const h = Math.floor(seconds / 3600)
  return `${h} hour${h === 1 ? '' : 's'} ago`
}

function formatHourLabel(h: number): string {
  if (h === 0) return '12am'
  if (h === 12) return 'noon'
  return h < 12 ? `${h}am` : `${h - 12}pm`
}

function formatClockTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Small non-interactive MapLibre inset rendered at block-level zoom. */
function MiniMap({ station }: { station: StationSnapshot }) {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const markerRef = useRef<Marker | null>(null)

  useEffect(() => {
    if (!ref.current || mapRef.current) return
    mapRef.current = new maplibregl.Map({
      container: ref.current,
      style: POSITRON_STYLE,
      center: [station.lon, station.lat],
      zoom: 15,
      interactive: false,
      attributionControl: false,
    })
    return () => {
      markerRef.current?.remove()
      markerRef.current = null
      mapRef.current?.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.setCenter([station.lon, station.lat])
    const total = station.num_bikes_available + station.num_docks_available
    const offline = !station.is_installed || !station.is_renting
    const { width, height } = pinSize(total)
    const svg = buildPinSVG(station.num_bikes_available, station.num_docks_available, { offline })

    let marker = markerRef.current
    let el: HTMLElement
    if (marker) {
      el = marker.getElement()
    } else {
      el = document.createElement('div')
      marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([station.lon, station.lat])
        .addTo(map)
      markerRef.current = marker
    }
    el.style.width = `${width}px`
    el.style.height = `${height}px`
    el.innerHTML = svg
  }, [
    station.lat,
    station.lon,
    station.num_bikes_available,
    station.num_docks_available,
    station.is_installed,
    station.is_renting,
  ])

  return <Box css={{ width: '100%', height: 240, overflow: 'hidden' }} ref={ref} />
}

type TypicalCalloutProps = { stationId: string; currentBikes: number }

function TypicalCallout({ stationId, currentBikes }: TypicalCalloutProps) {
  const theme = useTheme()
  const [profile, setProfile] = useState<TypicalProfile | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchStationTypical(API_BASE, SYSTEM_ID, stationId).then(
      p => { if (!cancelled) { setProfile(p); setError(null); setLoading(false) } },
      e => { if (!cancelled) { setError(e as Error); setLoading(false) } },
    )
    return () => { cancelled = true }
  }, [stationId])

  if (loading) {
    return <Hint icon={IconInfo}>Comparing to typical…</Hint>
  }
  if (error || !profile) {
    return <Hint icon={IconInfo}>Typical comparison unavailable right now.</Hint>
  }
  if (profile.daysCovered < 3) {
    const daysSoFar = profile.daysCovered
    return (
      <Hint icon={IconInfo}>
        <Flex direction="column" gap="2xs">
          <Text variant="title" size="s" strength="strong" color="default">
            Once there's enough history
          </Text>
          <Text variant="body" size="s" color="subdued">
            This card will compare the current bike count against the typical count for this hour and day of week
            — so you can tell at a glance whether the station is fuller, emptier, or about the same as usual.
          </Text>
          <Text variant="body" size="xs" color="subdued">
            {daysSoFar === 0
              ? 'No days of data yet. Need at least 3 days of polling to establish a baseline.'
              : `${daysSoFar} day${daysSoFar === 1 ? '' : 's'} of data so far. Need 3 days of polling for the baseline; 21 days enables the day-of-week filter.`}
          </Text>
        </Flex>
      </Hint>
    )
  }

  const bucket = profile.hours[profile.currentHour]
  const typical = bucket && bucket.samples > 0 ? bucket.bikes : 0
  const hourStr = formatHourLabel(profile.currentHour)
  const dayStr = profile.label
  const typicalStr = typical.toFixed(1)

  let title: string
  let body: string
  let tone: 'more' | 'fewer' | 'avg'

  if (typical <= 0) {
    title = 'No typical baseline yet.'
    body = `${currentBikes} bikes right now. We don't have typical data for ${hourStr} on ${dayStr} yet.`
    tone = 'avg'
  } else if (currentBikes >= typical * 1.5) {
    title = 'More bikes than typical right now.'
    body = `${currentBikes} bikes vs ~${typicalStr} typical for ${hourStr} on ${dayStr}.`
    tone = 'more'
  } else if (currentBikes <= typical * 0.5 || currentBikes <= Math.max(1, typical - 3)) {
    title = 'Fewer bikes than typical right now.'
    body = `${currentBikes} bikes vs ~${typicalStr} typical for ${hourStr} on ${dayStr}.`
    tone = 'fewer'
  } else {
    title = 'About average right now.'
    body = `${currentBikes} bikes (~${typicalStr} typical for ${hourStr} on ${dayStr}).`
    tone = 'avg'
  }

  const toneAccent =
    tone === 'more' ? theme.color.status.success
      : tone === 'fewer' ? theme.color.status.warning
      : theme.color.border.default

  return (
    <Paper
      p="l"
      borderRadius="m"
      shadow="near"
      border="default"
      direction="column"
      gap="2xs"
      css={{ borderLeft: `4px solid ${toneAccent}` }}
    >
      <Text variant="title" size="m" strength="strong" color="heading">{title}</Text>
      <Text variant="body" size="s" color="default">{body}</Text>
    </Paper>
  )
}

export default function StationDetails() {
  const theme = useTheme()
  const { stationId } = useParams<{ stationId: string }>()
  const { data: live, ageSec } = useLiveSnapshot(SYSTEM_ID)
  const activity = useActivity(SYSTEM_ID)
  const matrix = useTravelMatrix(R2_BASE, SYSTEM_ID)
  const routes = useRouteCache(R2_BASE, SYSTEM_ID)
  const [preset, setPreset] = useState<Preset>('24h')
  const [openTrip, setOpenTrip] = useState<Trip | null>(null)
  const [now] = useState(() => Math.floor(Date.now() / 1000))
  const range = useMemo(() => resolveRange(preset, now), [preset, now])

  const [tick, setTick] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const t = setInterval(() => setTick(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(t)
  }, [])

  const station = live?.stations.find(s => s.station_id === stationId)
  const totalDocks = station ? station.num_bikes_available + station.num_docks_available : undefined
  const offline = station ? !station.is_renting || !station.is_returning || !station.is_installed : false
  const mapsHref = station ? `https://www.google.com/maps/search/?api=1&query=${station.lat},${station.lon}` : null
  const pctFull = station && totalDocks ? Math.round((station.num_bikes_available / totalDocks) * 100) : null
  const reportedAge = station ? Math.max(0, tick - station.last_reported) : 0

  const series = useStationOverTime({
    apiBase: API_BASE,
    r2Base: R2_BASE,
    system: SYSTEM_ID,
    stationId: stationId ?? null,
    range,
  })

  const sparklineSeries = useMemo(() => {
    if (!series.data || series.data.length === 0) return { bikes: [], docks: [], timestamps: [] }
    const byHour = new Map<number, { bikes: number; docks: number; n: number }>()
    for (const row of series.data) {
      const hourTs = Math.floor(row.snapshot_ts / 3600) * 3600
      const cur = byHour.get(hourTs) ?? { bikes: 0, docks: 0, n: 0 }
      cur.bikes += row.bikes
      cur.docks += row.docks
      cur.n += 1
      byHour.set(hourTs, cur)
    }
    const sorted = Array.from(byHour.entries()).sort(([a], [b]) => a - b).slice(-24)
    return {
      bikes: sorted.map(([, v]) => v.bikes / v.n),
      docks: sorted.map(([, v]) => v.docks / v.n),
      timestamps: sorted.map(([ts]) => ts),
    }
  }, [series.data])

  const [sparkHover, setSparkHover] = useState<{ series: 'bikes' | 'docks'; index: number } | null>(null)
  const hoveredHourTs = sparkHover ? sparklineSeries.timestamps[sparkHover.index] : null
  const hoveredHourLabel = hoveredHourTs != null
    ? new Date(hoveredHourTs * 1000).toLocaleString(undefined, {
        weekday: 'short', hour: 'numeric', timeZone: live?.system.timezone,
      })
    : null
  const hoveredBikesVal = sparkHover?.series === 'bikes' && sparkHover.index < sparklineSeries.bikes.length
    ? sparklineSeries.bikes[sparkHover.index]
    : null
  const hoveredDocksVal = sparkHover?.series === 'docks' && sparkHover.index < sparklineSeries.docks.length
    ? sparklineSeries.docks[sparkHover.index]
    : null

  const nearby = useMemo(() => {
    if (!live || !station) return []
    return live.stations
      .filter(s => s.station_id !== station.station_id)
      .map(s => ({ s, miles: haversineMiles(station.lat, station.lon, s.lat, s.lon) }))
      .filter(({ miles }) => Number.isFinite(miles))
      .sort((a, b) => a.miles - b.miles)
      .slice(0, 5)
  }, [live, station])

  return (
    <Flex
      direction="column"
      gap="l"
      css={{ maxWidth: 1024, margin: '0 auto', padding: `${theme.spacing.l}px ${theme.spacing.l}px ${theme.spacing['3xl']}px` }}
    >
      <Link
        to="/"
        css={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: theme.spacing.xs,
          color: theme.color.text.subdued,
          textDecoration: 'none',
          fontSize: 14,
          alignSelf: 'flex-start',
          '&:hover': { color: theme.color.text.default, textDecoration: 'underline' },
        }}
      >
        <IconArrowLeft size="s" color="subdued" /> Back to live map
      </Link>

      {/* Hero: name + address on the left, live stats card on the right */}
      <Flex
        direction="column"
        gap="l"
        css={{
          '@media (min-width: 720px)': {
            flexDirection: 'row',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
          },
        }}
      >
        <Flex direction="column" gap="xs" css={{ minWidth: 0, flex: 1 }}>
          <Flex alignItems="center" gap="s" wrap="wrap">
            <Text variant="display" size="s" strength="strong" color="heading">
              {station?.name ?? <Text color="subdued" tag="span">Station {stationId}</Text>}
            </Text>
            {offline && <Tag>Offline</Tag>}
          </Flex>
          {station?.address && mapsHref && (
            <a
              href={mapsHref}
              target="_blank"
              rel="noopener noreferrer"
              css={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                color: theme.color.text.warning,
                textDecoration: 'none',
                fontSize: 14,
                '&:hover': { textDecoration: 'underline' },
              }}
            >
              {station.address} <IconExternalLink size="xs" color="warning" />
            </a>
          )}
          {station && (
            <Text variant="body" size="xs" color="subdued">
              Reported {formatAge(reportedAge)}
            </Text>
          )}
          {!station && live && (
            <Text variant="body" size="s" color="subdued">
              That station isn't in the current snapshot. It may have been recently removed, or the ID is wrong.
            </Text>
          )}
        </Flex>

        {station && (
          <Paper
            p="l"
            borderRadius="m"
            shadow="near"
            border="default"
            direction="column"
            gap="s"
            css={{ minWidth: 300 }}
          >
            <Text variant="label" size="xs" strength="strong" color="active" textTransform="uppercase">
              Right now
            </Text>
            <Flex gap="xl" alignItems="flex-end">
              <Flex direction="column" gap="2xs" css={{ minWidth: 130 }}>
                <Text variant="display" size="s" strength="strong" color="heading">
                  {station.num_bikes_available}
                </Text>
                <Text variant="label" size="xs" color="subdued" css={{ height: 16, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                  {hoveredBikesVal != null && hoveredHourLabel
                    ? `avg ${hoveredBikesVal.toFixed(1)} · ${hoveredHourLabel}`
                    : 'bikes available'}
                </Text>
                {sparklineSeries.bikes.length > 1 && (
                  <MiniLine
                    values={sparklineSeries.bikes}
                    color="#0d6cb0"
                    hoverIndex={sparkHover?.series === 'bikes' ? sparkHover.index : null}
                    onHoverIndexChange={i => setSparkHover(i === null ? null : { series: 'bikes', index: i })}
                  />
                )}
              </Flex>
              <Flex direction="column" gap="2xs" css={{ minWidth: 130 }}>
                <Flex alignItems="baseline" gap="2xs">
                  <Text variant="display" size="s" strength="strong" color="heading">
                    {station.num_docks_available}
                  </Text>
                  {totalDocks ? (
                    <Text variant="title" size="s" color="subdued">/ {totalDocks}</Text>
                  ) : null}
                </Flex>
                <Text variant="label" size="xs" color="subdued" css={{ height: 16, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                  {hoveredDocksVal != null && hoveredHourLabel
                    ? `avg ${hoveredDocksVal.toFixed(1)} · ${hoveredHourLabel}`
                    : 'open docks'}
                </Text>
                {sparklineSeries.docks.length > 1 && (
                  <MiniLine
                    values={sparklineSeries.docks}
                    color="#15803d"
                    hoverIndex={sparkHover?.series === 'docks' ? sparkHover.index : null}
                    onHoverIndexChange={i => setSparkHover(i === null ? null : { series: 'docks', index: i })}
                  />
                )}
              </Flex>
            </Flex>
            {pctFull !== null && (
              <Text variant="body" size="xs" color="subdued">{pctFull}% full</Text>
            )}
          </Paper>
        )}
      </Flex>

      {/* Mini map inset */}
      {station && (
        <Paper borderRadius="m" shadow="near" border="default" css={{ overflow: 'hidden' }}>
          <MiniMap station={station} />
        </Paper>
      )}

      {/* Typical patterns */}
      <Flex direction="column" gap="s">
        <Flex alignItems="center" justifyContent="space-between" gap="m" wrap="wrap">
          <Flex alignItems="center" gap="xs">
            <IconCalendarDay size="s" color="subdued" />
            <Text variant="title" size="m" strength="strong" color="heading">Typical patterns</Text>
          </Flex>
          <DateRangePicker value={preset} onChange={setPreset} />
        </Flex>
        <Text variant="body" size="xs" color="subdued">
          Half-hour averages. Each column is a stack of dock slots — filled from the bottom for bikes parked,
          faint slots up top for empty docks. Hover any column for the exact value.
        </Text>
        <Paper p="m" borderRadius="m" shadow="near" border="default">
          {!stationId && <Text variant="body" size="s" color="subdued">No station ID provided.</Text>}
          {stationId && series.error && (
            <pre css={{
              padding: 16,
              margin: 0,
              fontSize: 12,
              color: theme.color.text.danger,
              background: theme.color.background.surface1,
              border: `1px solid ${theme.color.border.default}`,
              borderRadius: theme.cornerRadius.s,
              whiteSpace: 'pre-wrap',
            }}>{series.error.message}</pre>
          )}
          {stationId && !series.error && (series.loading || !series.data) && (
            <ChartSkeleton aspectRatio={600 / 230} phase={series.phase} />
          )}
          {stationId && series.data && !series.loading && (
            <StationOverTimeChart data={series.data} totalDocks={totalDocks} show="squares" timezone={live?.system.timezone} />
          )}
        </Paper>
      </Flex>

      {/* Typical-vs-current callout */}
      {station && (
        <TypicalCallout stationId={station.station_id} currentBikes={station.num_bikes_available} />
      )}

      {/* Activity log at this station */}
      {station && (
        <Paper p="l" borderRadius="m" shadow="near" border="default" direction="column" gap="s">
          <Text variant="title" size="m" strength="strong" color="heading">Activity at this station</Text>
          <Text variant="body" size="xs" color="subdued">
            Recent departures and arrivals captured at this specific station, plus any inferred trips that
            started or ended here. Filtered live from the rolling 200-event window.
          </Text>
          {activity.error && (
            <pre css={{
              padding: 16, margin: 0, fontSize: 12,
              color: theme.color.text.danger,
              background: theme.color.background.surface1,
              border: `1px solid ${theme.color.border.default}`,
              borderRadius: theme.cornerRadius.s,
              whiteSpace: 'pre-wrap',
            }}>{activity.error.message}</pre>
          )}
          {!activity.error && (
            <ActivityLog
              log={activity.data}
              stations={live?.stations ?? []}
              matrix={matrix.data}
              timezone={live?.system.timezone}
              stationFilter={station.station_id}
              onTripClick={setOpenTrip}
            />
          )}
        </Paper>
      )}

      {/* Nearby stations */}
      {nearby.length > 0 && (
        <Flex direction="column" gap="s">
          <Text variant="title" size="m" strength="strong" color="heading">Nearby stations</Text>
          <Paper borderRadius="m" shadow="near" border="default" direction="column" css={{ overflow: 'hidden' }}>
            {nearby.map(({ s, miles }, idx) => {
              const total = s.num_bikes_available + s.num_docks_available
              return (
                <Flex
                  key={s.station_id}
                  alignItems="center"
                  justifyContent="space-between"
                  gap="m"
                  css={{
                    padding: `${theme.spacing.s}px ${theme.spacing.l}px`,
                    borderTop: idx === 0 ? 'none' : `1px solid ${theme.color.border.default}`,
                    transition: `background ${theme.motion.quick}`,
                    '&:hover': { background: theme.color.background.surface1 },
                  }}
                >
                  <Flex direction="column" gap="2xs" css={{ minWidth: 0, flex: 1 }}>
                    <Text variant="body" size="s" strength="strong" color="heading" ellipses>{s.name}</Text>
                    <Text variant="body" size="xs" color="subdued">{formatDistance(miles)} away</Text>
                  </Flex>
                  <Flex alignItems="center" gap="m" css={{ flexShrink: 0 }}>
                    <Flex direction="column" alignItems="center" gap="2xs" css={{ minWidth: 56 }}>
                      <Text variant="title" size="s" strength="strong" color="heading">{s.num_bikes_available}</Text>
                      <Text variant="label" size="xs" color="subdued">bikes</Text>
                    </Flex>
                    <Flex direction="column" alignItems="center" gap="2xs" css={{ minWidth: 64 }}>
                      <Text variant="title" size="s" strength="strong" color="heading">
                        {s.num_docks_available}{total > 0 ? <Text tag="span" color="subdued"> / {total}</Text> : null}
                      </Text>
                      <Text variant="label" size="xs" color="subdued">docks</Text>
                    </Flex>
                    <Link
                      to={`/station/${encodeURIComponent(s.station_id)}/details`}
                      css={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        color: theme.color.text.accent,
                        fontSize: 14,
                        fontWeight: 600,
                        textDecoration: 'none',
                        '&:hover': { textDecoration: 'underline' },
                      }}
                    >
                      Details <IconCaretRight size="xs" color="accent" />
                    </Link>
                  </Flex>
                </Flex>
              )
            })}
          </Paper>
        </Flex>
      )}

      <Flex
        direction="column"
        gap="xs"
        css={{
          paddingTop: theme.spacing.l,
          borderTop: `1px solid ${theme.color.border.default}`,
          '@media (min-width: 540px)': { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
        }}
      >
        <Text variant="body" size="xs" color="subdued">
          Tip: bookmark{' '}
          <code css={{
            background: theme.color.background.surface1,
            padding: '1px 6px',
            borderRadius: theme.cornerRadius.xs,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 12,
          }}>
            /station/{stationId}/details
          </code>{' '}
          to come back.
        </Text>
        {live && (
          <Text variant="body" size="xs" color="subdued">
            Last updated: {formatClockTime(live.snapshot_ts)}
            <Text tag="span" color="subdued"> ({ageSec < 60 ? `${ageSec}s` : `${Math.floor(ageSec / 60)}m`} ago)</Text>
          </Text>
        )}
      </Flex>

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
