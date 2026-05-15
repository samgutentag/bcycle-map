import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Flex, IconArrowLeft, Paper, Text, useTheme } from '@audius/harmony'
import { useLiveSnapshot } from '../hooks/useLiveSnapshot'
import { useActivity } from '../hooks/useActivity'
import { useTravelMatrix } from '../hooks/useTravelMatrix'
import { useRouteCache } from '../hooks/useRouteCache'
import ActivityLog from '../components/ActivityLog'
import TripRouteModal from '../components/TripRouteModal'
import type { Trip } from '@shared/types'

const SYSTEM_ID = 'bcycle_santabarbara'
const R2_BASE = import.meta.env.VITE_R2_PUBLIC_URL ?? 'https://pub-83059e704dd64536a5166ab289eb42e5.r2.dev'

export default function Activity() {
  const theme = useTheme()
  const { data: live } = useLiveSnapshot(SYSTEM_ID)
  const activity = useActivity(SYSTEM_ID)
  const matrix = useTravelMatrix(R2_BASE, SYSTEM_ID)
  const routes = useRouteCache(R2_BASE, SYSTEM_ID)
  const [openTrip, setOpenTrip] = useState<Trip | null>(null)

  const eventCount = activity.data?.events.length ?? 0
  const tripCount = activity.data?.trips.length ?? 0

  return (
    <Flex
      direction="column"
      gap="l"
      css={{ maxWidth: 1280, margin: '0 auto', padding: `${theme.spacing.l}px ${theme.spacing.l}px ${theme.spacing['3xl']}px` }}
    >
      <Link
        to="/explore"
        css={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: theme.spacing.xs,
          color: theme.color.text.subdued,
          textDecoration: 'none',
          fontSize: 13,
          alignSelf: 'flex-start',
          '&:hover': { color: theme.color.text.default, textDecoration: 'underline' },
        }}
      >
        <IconArrowLeft size="s" color="subdued" /> Back to Explore
      </Link>

      <Flex direction="column" gap="xs">
        <Text variant="display" size="s" strength="strong" color="heading">
          Activity log
        </Text>
        <Text variant="body" size="s" color="subdued">
          The poller diffs per-station bike counts every two minutes and emits a departure (count down) or arrival
          (count up) event for any station that changed. Trips are paired only when the system passes cleanly through
          a single active rider, so they're rare during busy hours and clump up overnight. Capped to the most recent
          200 events and 50 trips in storage.
        </Text>
        <Text variant="body" size="xs" color="subdued">
          {eventCount} {eventCount === 1 ? 'event' : 'events'} · {tripCount} inferred {tripCount === 1 ? 'trip' : 'trips'}
        </Text>
      </Flex>

      <Paper p="m" borderRadius="m" shadow="near" border="default">
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
            maxEvents={200}
            maxTrips={50}
            unbounded
            onTripClick={setOpenTrip}
          />
        )}
      </Paper>

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
