import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { Map as MlMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Flex, Text, useTheme } from '@audius/harmony'
import { useLiveSnapshot } from '../hooks/useLiveSnapshot'
import { useFlowTrips } from '../hooks/useFlowTrips'
import { useRouteCache } from '../hooks/useRouteCache'
import { useTravelMatrix } from '../hooks/useTravelMatrix'
import FlowTimelineScrubber from '../components/FlowTimelineScrubber'
import BikeAnimationLayer from '../components/BikeAnimationLayer'
import { selectVisibleTrips, capTripsForRender } from '../lib/flow-selection'
import { buildPinSVG, pinSize } from '../lib/pin-svg'

const SYSTEM_ID = 'bcycle_santabarbara'
const SB_CENTER: [number, number] = [-119.6982, 34.4208]
const POSITRON_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
const R2_BASE = import.meta.env.VITE_R2_PUBLIC_URL ?? 'https://pub-83059e704dd64536a5166ab289eb42e5.r2.dev'

const MAX_BIKES_PER_FRAME = 80

export default function FlowMap() {
  const theme = useTheme()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [map, setMap] = useState<MlMap | null>(null)

  const { data: live } = useLiveSnapshot(SYSTEM_ID)
  const { trips, windowStart, windowEnd, loading: tripsLoading } = useFlowTrips(SYSTEM_ID)
  const routes = useRouteCache(R2_BASE, SYSTEM_ID)
  const matrix = useTravelMatrix(R2_BASE, SYSTEM_ID)

  const [cursorTs, setCursorTs] = useState<number>(windowEnd)
  const [playing, setPlaying] = useState(false)

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

  // Render the static station pins, sized by capacity, no popups bound.
  // Live counts here represent "now" — see the snapshot-rewind caveat in the
  // header note below. The spec wants historical snapshots; v1 ships with
  // live pins and a clear caption explaining the limitation.
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  useEffect(() => {
    if (!map || !live) return
    const seen = new Set<string>()
    for (const s of live.stations) {
      seen.add(s.station_id)
      const total = s.num_bikes_available + s.num_docks_available
      const offline = !s.is_installed || !s.is_renting
      const { width, height } = pinSize(total)
      const svg = buildPinSVG(s.num_bikes_available, s.num_docks_available, { offline })
      let marker = markersRef.current.get(s.station_id)
      let el: HTMLElement
      if (marker) {
        el = marker.getElement()
      } else {
        el = document.createElement('div')
        el.style.pointerEvents = 'none'
        // Pins on the flow page are non-interactive; let the bike dots be the
        // visual focus. (Spec: no popups, no clickable pins by default.)
        marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([s.lon, s.lat])
          .addTo(map)
        markersRef.current.set(s.station_id, marker)
      }
      el.style.width = `${width}px`
      el.style.height = `${height}px`
      el.style.opacity = '0.55'  // mute pins so animated bikes pop
      el.innerHTML = svg
    }
    for (const [id, m] of markersRef.current) {
      if (!seen.has(id)) { m.remove(); markersRef.current.delete(id) }
    }
  }, [map, live])

  // Visible-window selection. Pure function, easy to test in isolation.
  const visible = useMemo(() => selectVisibleTrips(trips, cursorTs), [trips, cursorTs])
  const { rendered, totalCount } = useMemo(
    () => capTripsForRender(visible, MAX_BIKES_PER_FRAME),
    [visible],
  )

  // Spacebar play/pause. Bound at document level so the user doesn't need
  // to keyboard-focus the button to use it. Skip if the user is typing into
  // an input/textarea elsewhere on the page.
  const togglePlay = useCallback(() => setPlaying(p => !p), [])
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.code !== 'Space') return
      const target = ev.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
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
    if (totalCount === 0) return 'No trips active at this moment — scrub elsewhere.'
    return `${totalCount} trip${totalCount === 1 ? '' : 's'} active at cursor`
  }, [tripsLoading, routes.loading, trips.length, totalCount, rendered.length])

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
        <BikeAnimationLayer
          map={map}
          trips={rendered}
          routes={routes.data}
          matrix={matrix.data}
          cursorTs={cursorTs}
          playing={playing}
          windowStart={windowStart}
          windowEnd={windowEnd}
          onCursorAdvance={setCursorTs}
        />
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
          <strong css={{ color: theme.color.text.heading }}>Flow (v1)</strong> — animated bikes follow
          cached routes for each inferred trip in the rolling 24h window. Pin counts shown reflect
          <em> right now</em>, not the scrubbed timestamp; historical pin rewind ships in v2 (#52).
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
      />
      {!live && (
        <Text variant="body" size="xs" color="subdued" css={{ padding: theme.spacing.s }}>
          Loading live snapshot…
        </Text>
      )}
    </Flex>
  )
}
