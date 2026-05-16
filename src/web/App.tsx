import { lazy, Suspense, useState } from 'react'
import { Routes, Route, NavLink, useLocation } from 'react-router-dom'
import {
  Box,
  Flex,
  IconExplore,
  IconInfo,
  IconRadar,
  LoadingSpinner,
  Text,
  useTheme,
} from '@audius/harmony'
import LiveMap from './routes/LiveMap'
import { useBeaconReporter } from './hooks/useBeaconReporter'
import AboutModal from './components/AboutModal'
import BrandMark from './components/BrandMark'
import ThemeToggle from './components/ThemeToggle'
import { IconBike } from './components/icons'
import type { ComponentType } from 'react'
import { useStableVerb } from './lib/spinner-verbs'

function BeaconReporter() {
  useBeaconReporter()
  return null
}

const Explore = lazy(() => import('./routes/Explore'))
const RouteCheck = lazy(() => import('./routes/RouteCheck'))
const StationDetails = lazy(() => import('./routes/StationDetails'))
const Activity = lazy(() => import('./routes/Activity'))
const Insights = lazy(() => import('./routes/Insights'))

// Accepts either a Harmony IconComponent or a local custom icon (see icons.tsx).
// Loose typing because both icon families have slightly different props but
// render-call-compatible at `{ size, color }`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NavIcon = ComponentType<any>
type NavSpec = { to: string; label: string; Icon: NavIcon; matchPrefix?: string }

const PRIMARY_NAV: NavSpec[] = [
  { to: '/', label: 'Live', Icon: IconRadar, matchPrefix: '/station' },
  { to: '/route', label: 'Route', Icon: IconBike },
  { to: '/explore', label: 'Explore', Icon: IconExplore, matchPrefix: '/activity' },
]

function PrimaryNavLink({ to, label, Icon, matchPrefix }: NavSpec) {
  const theme = useTheme()
  const location = useLocation()
  const isExact = location.pathname === to
  const isPrefix = matchPrefix
    ? location.pathname.startsWith(matchPrefix)
    : to !== '/' && location.pathname.startsWith(to)
  const active = isExact || isPrefix

  return (
    <NavLink
      to={to}
      end={to === '/'}
      aria-current={active ? 'page' : undefined}
      css={{
        textDecoration: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        gap: theme.spacing.xs,
        padding: `${theme.spacing.xs}px ${theme.spacing.s}px`,
        borderRadius: theme.cornerRadius.s,
        color: active ? theme.color.text.heading : theme.color.text.subdued,
        background: active ? theme.color.background.surface1 : 'transparent',
        transition: `background ${theme.motion.quick}, color ${theme.motion.quick}`,
        '&:hover': {
          color: theme.color.text.default,
          background: theme.color.background.surface1,
        },
        '&:focus-visible': {
          outline: `2px solid ${theme.color.focus.default}`,
          outlineOffset: 2,
        },
      }}
    >
      <Icon size="s" color={active ? 'default' : 'subdued'} />
      <Text
        variant="title"
        size="s"
        strength={active ? 'strong' : 'default'}
        color="inherit"
        css={{ '@media (max-width: 600px)': { display: 'none' } }}
      >
        {label}
      </Text>
    </NavLink>
  )
}

function AppHeader({ onOpenAbout }: { onOpenAbout: () => void }) {
  const theme = useTheme()
  return (
    <Box
      as="header"
      css={{
        position: 'sticky',
        top: 0,
        zIndex: 30,
        background: `color-mix(in srgb, ${theme.color.background.white} 88%, transparent)`,
        backdropFilter: 'saturate(140%) blur(10px)',
        borderBottom: `1px solid ${theme.color.border.default}`,
      }}
    >
      <Flex
        alignItems="center"
        justifyContent="space-between"
        gap="m"
        css={{
          maxWidth: 1280,
          margin: '0 auto',
          padding: `${theme.spacing.s}px ${theme.spacing.l}px`,
          '@media (max-width: 600px)': {
            padding: `${theme.spacing.xs}px ${theme.spacing.s}px`,
            gap: theme.spacing.xs,
          },
        }}
      >
        <NavLink to="/" css={{ textDecoration: 'none', color: 'inherit' }} aria-label="bcycle-map home">
          <BrandMark />
        </NavLink>

        <Flex
          as="nav"
          alignItems="center"
          gap="2xs"
          aria-label="Primary"
        >
          {PRIMARY_NAV.map((n) => (
            <PrimaryNavLink key={n.to} {...n} />
          ))}
        </Flex>

        <Flex alignItems="center" gap="s">
          <ThemeToggle />
          <button
            type="button"
            onClick={onOpenAbout}
            aria-label="About"
            title="About"
            css={{
              all: 'unset',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              borderRadius: theme.cornerRadius.s,
              color: theme.color.text.subdued,
              border: `1px solid ${theme.color.border.default}`,
              background: theme.color.background.surface1,
              transition: `color ${theme.motion.quick}, background ${theme.motion.quick}`,
              '&:hover': { color: theme.color.text.default, background: theme.color.background.white },
              '&:focus-visible': { outline: `2px solid ${theme.color.focus.default}`, outlineOffset: 1 },
            }}
          >
            <IconInfo size="s" color="subdued" />
          </button>
        </Flex>
      </Flex>
    </Box>
  )
}

function RouteFallback() {
  const verb = useStableVerb()
  return (
    <Flex
      direction="column"
      alignItems="center"
      justifyContent="center"
      gap="m"
      css={{ minHeight: 280, padding: '32px 16px' }}
    >
      <LoadingSpinner css={{ width: 32, height: 32 }} />
      <Text variant="body" size="s" color="subdued">
        {verb}
      </Text>
    </Flex>
  )
}

export default function App() {
  const [aboutOpen, setAboutOpen] = useState(false)
  return (
    <Flex direction="column" css={{ minHeight: '100vh', background: 'var(--app-bg)' }}>
      <BeaconReporter />
      <AppHeader onOpenAbout={() => setAboutOpen(true)} />
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <Box as="main" css={{ flex: 1 }}>
        <Routes>
          <Route path="/" element={<LiveMap />} />
          <Route path="/station/:stationId" element={<LiveMap />} />
          <Route
            path="/station/:stationId/details"
            element={
              <Suspense fallback={<RouteFallback />}>
                <StationDetails />
              </Suspense>
            }
          />
          <Route
            path="/route"
            element={
              <Suspense fallback={<RouteFallback />}>
                <RouteCheck />
              </Suspense>
            }
          />
          <Route
            path="/route/:startId"
            element={
              <Suspense fallback={<RouteFallback />}>
                <RouteCheck />
              </Suspense>
            }
          />
          <Route
            path="/route/:startId/:endId"
            element={
              <Suspense fallback={<RouteFallback />}>
                <RouteCheck />
              </Suspense>
            }
          />
          <Route
            path="/explore"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Explore />
              </Suspense>
            }
          />
          <Route
            path="/activity"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Activity />
              </Suspense>
            }
          />
          <Route
            path="/insights"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Insights />
              </Suspense>
            }
          />
        </Routes>
      </Box>
    </Flex>
  )
}
