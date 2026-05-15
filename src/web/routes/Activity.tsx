import { useState } from 'react'
import { Link } from 'react-router-dom'
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
  const { data: live } = useLiveSnapshot(SYSTEM_ID)
  const activity = useActivity(SYSTEM_ID)
  const matrix = useTravelMatrix(R2_BASE, SYSTEM_ID)
  const routes = useRouteCache(R2_BASE, SYSTEM_ID)
  const [openTrip, setOpenTrip] = useState<Trip | null>(null)

  const eventCount = activity.data?.events.length ?? 0
  const tripCount = activity.data?.trips.length ?? 0

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-4">
        <Link to="/explore" className="text-xs text-sky-700 hover:underline">← Back to Explore</Link>
      </div>

      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-neutral-900">Activity log</h2>
        <p className="text-sm text-neutral-600 mt-1">
          The poller diffs per-station bike counts every two minutes and emits a departure (count down) or arrival (count up) event for any station that changed. Trips are paired only when the system passes cleanly through a single active rider, so they're rare during busy hours and clump up overnight. Capped to the most recent 200 events and 50 trips in storage.
        </p>
        <p className="text-xs text-neutral-500 mt-2">
          {eventCount} {eventCount === 1 ? 'event' : 'events'} · {tripCount} inferred {tripCount === 1 ? 'trip' : 'trips'}
        </p>
      </div>

      <section className="bg-white rounded-lg shadow-sm border border-neutral-200 p-4">
        {activity.error && (
          <pre className="p-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded whitespace-pre-wrap select-all">{activity.error.message}</pre>
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
      </section>
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
    </div>
  )
}
