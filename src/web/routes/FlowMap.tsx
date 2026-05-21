import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { Map as MlMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Flex, Text, useTheme } from '@audius/harmony'
import { useLiveSnapshot } from '../hooks/useLiveSnapshot'
import { useFlowTrips } from '../hooks/useFlowTrips'
import { useHistoricalSnapshots } from '../hooks/useHistoricalSnapshots'
import { useRouteCache } from '../hooks/useRouteCache'
import { useTravelMatrix } from '../hooks/useTravelMatrix'
import FlowTimelineScrubber from '../components/FlowTimelineScrubber'
import BikeAnimationLayer, { TRAIL_GHOST_FADE_SEC } from '../components/BikeAnimationLayer'
import FogOfWorldLayer from '../components/FogOfWorldLayer'
import FogToggle from '../components/FogToggle'
import { selectVisibleTrips, capTripsForRender } from '../lib/flow-selection'
import { computeDynamicWindow } from '../lib/flow-window'

const SYSTEM_ID = 'bcycle_santabarbara'
const SB_CENTER: [number, number] = [-119.6982, 34.4208]
const POSITRON_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
const R2_BASE = import.meta.env.VITE_R2_PUBLIC_URL ?? 'https://pub-83059e704dd64536a5166ab289eb42e5.r2.dev'

const MAX_BIKES_PER_FRAME = 80
const FOG_ENABLED_KEY = 'bcycle-map:flow-fog-enabled'

export default function FlowMap() {
  const theme = useTheme()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [map, setMap] = useState<MlMap | null>(null)

  const { data: live } = useLiveSnapshot(SYSTEM_ID)
  const { trips, windowEnd: fetchWindowEnd, loading: tripsLoading } = useFlowTrips(SYSTEM_ID)
  // Dynamic window (#56): shrink the scrubber to
  // [max(now-24h, oldestTripDeparture - 5min), now] so quiet days don't show
  // a mostly-empty 24h slider. Recomputed when either the trip set or the
  // fetch's "now" anchor changes. Returns {0, 0} until the fetch resolves so
  // dependent hooks (useHistoricalSnapshots) stay idle on the initial render.
  const { windowStart, windowEnd } = useMemo(() => {
    if (fetchWindowEnd <= 0) return { windowStart: 0, windowEnd: 0 }
    return computeDynamicWindow(trips, fetchWindowEnd)
  }, [trips, fetchWindowEnd])
  const { getSnapshotAt } = useHistoricalSnapshots(SYSTEM_ID, windowStart, windowEnd)
  const routes = useRouteCache(R2_BASE, SYSTEM_ID)
  const matrix = useTravelMatrix(R2_BASE, SYSTEM_ID)

  const [cursorTs, setCursorTs] = useState<number>(windowEnd)
  const [playing, setPlaying] = useState(false)

  // Fog-of-world toggle (#57). Persisted across reloads via localStorage —
  // '1' or '0'; defaults to '0' (off) for first-time visitors so the page
  // looks the way it always did and nobody arrives at a black screen
  // wondering what broke.
  const [fogEnabled, setFogEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    try {
      return window.localStorage.getItem(FOG_ENABLED_KEY) === '1'
    } catch {
      return false
    }
  })
  const toggleFog = useCallback(() => {
    setFogEnabled(prev => {
      const next = !prev
      try {
        window.localStorage.setItem(FOG_ENABLED_KEY, next ? '1' : '0')
      } catch {
        // Private-browsing / quota errors — keep the in-memory toggle but
        // don't persist. Not worth surfacing.
      }
      return next
    })
  }, [])

  // Boot the map once. Render mode is "view-only" — no clickable pins,
  // no popups, per the spec ("this is a viewing experience").
  useEffect(() => {
    if (!containerRef.current || map) return
    const m = new maplibregl.Map({
      container: containerRef.current,
      style: POSITRON_STYLE,
      center: SB_CENTER,
      zoom: 13,
    })
    setMap(m)
    return () => { m.remove() }
    // Intentionally not depending on `map` — we only ever boot once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync cursor to windowEnd ("now") the first time the data window resolves.
  // After that we trust the user's scrub position. We track this with a ref
  // so a later React re-render doesn't reset the user's scroll position.
  const cursorInitRef = useRef(false)
  useEffect(() => {
    if (cursorInitRef.current) return
    if (windowEnd > 0) {
      setCursorTs(windowEnd)
      cursorInitRef.current = true
    }
  }, [windowEnd])

  // Fit-to-station-bounds on first data load, same logic as LiveMap.
  // No popup behavior here — pins are static visual indicators only.
  const fitBoundsAppliedRef = useRef(false)
  useEffect(() => {
    if (!map || !live || fitBoundsAppliedRef.current) return
    const valid = live.stations.filter(s =>
      Number.isFinite(s.lat) && Number.isFinite(s.lon) && s.lat !== 0 && s.lon !== 0,
    )
    if (valid.length === 0) return
    const lats = valid.map(s => s.lat)
    const lons = valid.map(s => s.lon)
    const minLat = Math.min(...lats), maxLat = Math.max(...lats)
    const minLon = Math.min(...lons), maxLon = Math.max(...lons)
    const latPad = (maxLat - minLat) * 0.2
    const lonPad = (maxLon - minLon) * 0.2
    const bounds: [[number, number], [number, number]] = [
      [minLon - lonPad, minLat - latPad],
      [maxLon + lonPad, maxLat + latPad],
    ]
    map.fitBounds(bounds, { padding: 0, duration: 0, animate: false })
    fitBoundsAppliedRef.current = true
  }, [map, live])

  // Render station markers as tiny static dots — no count text, no
  // capacity-scaled pin. The flow page's hero is the animated bikes; pins
  // are scenery to anchor the eye. Offline stations render dimmer but still
  // visible so the user knows they exist.
  //
  // The full /live pin treatment (count text, capacity-scaled teardrop)
  // would dominate the canvas and bury the moving bikes.
  //
  // Pin counts (#52): we read each station's bike/dock counts from the
  // historical snapshot at the cursor — `getSnapshotAt(cursorTs)`. While
  // the historical fetch is in flight (or for stations that didn't exist
  // at the cursor's ts) we fall back to live counts. `is_installed` /
  // `is_renting` stay sourced from `live` either way — the parquet
  // archive doesn't carry the install/rent flags.
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const historicalStations = useMemo(() => getSnapshotAt(cursorTs), [getSnapshotAt, cursorTs])
  const historicalById = useMemo(() => {
    if (!historicalStations) return null
    const m = new Map<string, { num_bikes_available: number; num_docks_available: number }>()
    for (const s of historicalStations) m.set(s.station_id, s)
    return m
  }, [historicalStations])
  useEffect(() => {
    if (!map || !live) return
    const seen = new Set<string>()
    for (const s of live.stations) {
      seen.add(s.station_id)
      const offline = !s.is_installed || !s.is_renting
      // Historical-or-live count source per the spec: getSnapshotAt(ts) ??
      // live.stations. While the historical fetch is in flight (or for a
      // station that didn't exist at the cursor's ts) we fall through to
      // live. The dim treatment now reflects bike availability at the
      // cursor — a station empty *now* but stocked 4 hours ago renders
      // bright when the user scrubs back.
      const counts = historicalById?.get(s.station_id) ?? s
      const empty = !offline && counts.num_bikes_available === 0
      let marker = markersRef.current.get(s.station_id)
      let el: HTMLElement
      if (marker) {
        el = marker.getElement()
      } else {
        el = document.createElement('div')
        el.style.pointerEvents = 'none'
        // Pins on the flow page are non-interactive; let the bike dots be
        // the visual focus. (Spec: no popups, no clickable pins by default.)
        marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([s.lon, s.lat])
          .addTo(map)
        markersRef.current.set(s.station_id, marker)
      }
      el.style.width = '8px'
      el.style.height = '8px'
      el.style.borderRadius = '50%'
      // Offline > empty > stocked. The empty tier matches /live's "dim pin"
      // idiom — a pin without bikes is visually backgrounded so the eye
      // lands on stocked pins.
      el.style.background = offline
        ? 'rgba(120, 120, 120, 0.35)'
        : empty
          ? 'rgba(80, 80, 80, 0.35)'
          : 'rgba(80, 80, 80, 0.6)'
      el.style.border = '1px solid rgba(255, 255, 255, 0.8)'
      el.style.boxShadow = '0 0 1px rgba(0, 0, 0, 0.3)'
    }
    for (const [id, m] of markersRef.current) {
      if (!seen.has(id)) { m.remove(); markersRef.current.delete(id) }
    }
  }, [map, live, historicalById])

  // Visible-window selection. Two passes: `alive` is strict (drives the
  // "N trips active at cursor" caption), `renderable` extends the window
  // by TRAIL_GHOST_FADE_SEC so the trail can linger + fade for a moment
  // after the bike arrives instead of popping out of existence.
  const alive = useMemo(() => selectVisibleTrips(trips, cursorTs), [trips, cursorTs])
  const renderable = useMemo(
    () => selectVisibleTrips(trips, cursorTs, TRAIL_GHOST_FADE_SEC),
    [trips, cursorTs],
  )
  const { rendered, totalCount } = useMemo(
    () => capTripsForRender(renderable, MAX_BIKES_PER_FRAME),
    [renderable],
  )
  // Caption count reflects ALIVE trips only — ghosts are visual lingerers,
  // not "active" rides.
  const aliveCount = alive.length

  // Departure timestamps for the scrubber's density markers + prev/next trip
  // buttons. Memoized so a 4Hz cursor update during playback doesn't keep
  // remapping the same 50-trip list.
  const tripTimestamps = useMemo(() => trips.map(t => t.departure_ts), [trips])

  // Playback-loop bounds tight to the active trip cluster. Without this
  // the cursor wraps through the full 24h on every loop, which on quiet
  // days is mostly dead air. With it, ▶ Play loops the busy window
  // forever while manual scrubbing still walks the full window for
  // history. Falls back to undefined (= use windowStart/windowEnd) when
  // there are no trips at all.
  const { playbackLoopStart, playbackLoopEnd } = useMemo(() => {
    if (trips.length === 0) return { playbackLoopStart: undefined, playbackLoopEnd: undefined }
    let minDep = Infinity
    let maxArr = -Infinity
    for (const t of trips) {
      if (t.departure_ts < minDep) minDep = t.departure_ts
      if (t.arrival_ts > maxArr) maxArr = t.arrival_ts
    }
    // 60s of lead-in lets the first bike "appear" rather than already
    // being mid-trip on the first frame; 60s of lead-out gives a brief
    // settle before the loop restarts.
    return { playbackLoopStart: minDep - 60, playbackLoopEnd: maxArr + 60 }
  }, [trips])

  // Spacebar play/pause. Bound at document level so the user doesn't need
  // to keyboard-focus the button to use it. Skip if the user is typing into
  // an input/textarea elsewhere on the page.
  const togglePlay = useCallback(() => setPlaying(p => !p), [])
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.code !== 'Space') return
      const target = ev.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON' || target.isContentEditable)) return
      ev.preventDefault()
      togglePlay()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay])

  const timezone = live?.system.timezone
  const caption = useMemo(() => {
    if (tripsLoading) return 'Loading trips…'
    if (routes.loading) return 'Loading route polylines…'
    if (trips.length === 0) return 'No inferred trips in the last 24 hours yet.'
    if (totalCount > rendered.length) {
      return `Showing ${rendered.length} of ${totalCount} trips at cursor (capped for performance)`
    }
    if (aliveCount === 0) return 'No trips active at this moment — scrub elsewhere.'
    return `${aliveCount} trip${aliveCount === 1 ? '' : 's'} active at cursor`
  }, [tripsLoading, routes.loading, trips.length, totalCount, rendered.length, aliveCount])

  return (
    <Flex direction="column" css={{ height: 'calc(100vh - 49px)' }}>
      <div
        ref={containerRef}
        css={{
          flex: 1,
          position: 'relative',
          background: theme.color.background.surface1,
        }}
      >
        <FogOfWorldLayer
          map={map}
          trips={rendered}
          routes={routes.data}
          cursorTs={cursorTs}
          enabled={fogEnabled}
        />
        <BikeAnimationLayer
          map={map}
          trips={rendered}
          allTrips={trips}
          routes={routes.data}
          matrix={matrix.data}
          cursorTs={cursorTs}
          playing={playing}
          windowStart={windowStart}
          windowEnd={windowEnd}
          playbackLoopStart={playbackLoopStart}
          playbackLoopEnd={playbackLoopEnd}
          onCursorAdvance={setCursorTs}
        />
        <FogToggle enabled={fogEnabled} onToggle={toggleFog} />
        <div
          aria-live="polite"
          css={{
            position: 'absolute',
            top: 12,
            left: 12,
            padding: '6px 10px',
            borderRadius: 8,
            background: 'rgba(255,255,255,0.92)',
            border: `1px solid ${theme.color.border.default}`,
            fontSize: 11,
            color: theme.color.text.subdued,
            maxWidth: 320,
            lineHeight: 1.4,
            pointerEvents: 'none',
          }}
        >
          <strong css={{ color: theme.color.text.heading }}>Flow</strong> — animated bikes follow
          cached routes for trips in the past 24 hours.
        </div>
      </div>
      <FlowTimelineScrubber
        cursorTs={cursorTs}
        windowStart={windowStart}
        windowEnd={windowEnd}
        playing={playing}
        onCursorChange={ts => { setCursorTs(ts); setPlaying(false) }}
        onPlayToggle={togglePlay}
        caption={caption}
        timezone={timezone}
        tripTimestamps={tripTimestamps}
      />
      {!live && (
        <Text variant="body" size="xs" color="subdued" css={{ padding: theme.spacing.s }}>
          Loading live snapshot…
        </Text>
      )}
    </Flex>
  )
}
