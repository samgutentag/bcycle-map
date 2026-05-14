import { lazy, Suspense } from 'react'
import { Routes, Route, Link } from 'react-router-dom'
import LiveMap from './routes/LiveMap'
import { useBeaconReporter } from './hooks/useBeaconReporter'

function BeaconReporter() {
  useBeaconReporter()
  return null
}

const Explore = lazy(() => import('./routes/Explore'))
const RouteCheck = lazy(() => import('./routes/RouteCheck'))
const StationDetails = lazy(() => import('./routes/StationDetails'))
const Activity = lazy(() => import('./routes/Activity'))
const Insights = lazy(() => import('./routes/Insights'))

export default function App() {
  return (
    <div className="min-h-screen flex flex-col bg-neutral-50 text-neutral-900">
      <BeaconReporter />
      <header className="px-4 py-3 border-b border-neutral-200 bg-white flex items-center gap-4">
        <h1 className="font-semibold">bcycle-map</h1>
        <nav className="flex gap-3 text-sm text-neutral-700">
          <Link to="/" className="hover:underline">Live</Link>
          <Link to="/route" className="hover:underline">Route planner</Link>
          <Link to="/explore" className="hover:underline">Explore</Link>
        </nav>
      </header>
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<LiveMap />} />
          <Route path="/station/:stationId" element={<LiveMap />} />
          <Route
            path="/station/:stationId/details"
            element={
              <Suspense fallback={<div className="p-8 text-center text-neutral-500">Loading station details…</div>}>
                <StationDetails />
              </Suspense>
            }
          />
          <Route
            path="/route"
            element={
              <Suspense fallback={<div className="p-8 text-center text-neutral-500">Loading route check…</div>}>
                <RouteCheck />
              </Suspense>
            }
          />
          <Route
            path="/route/:startId"
            element={
              <Suspense fallback={<div className="p-8 text-center text-neutral-500">Loading route check…</div>}>
                <RouteCheck />
              </Suspense>
            }
          />
          <Route
            path="/route/:startId/:endId"
            element={
              <Suspense fallback={<div className="p-8 text-center text-neutral-500">Loading route check…</div>}>
                <RouteCheck />
              </Suspense>
            }
          />
          <Route
            path="/explore"
            element={
              <Suspense fallback={<div className="p-8 text-center text-neutral-500">Loading explore view…</div>}>
                <Explore />
              </Suspense>
            }
          />
          <Route
            path="/activity"
            element={
              <Suspense fallback={<div className="p-8 text-center text-neutral-500">Loading activity log…</div>}>
                <Activity />
              </Suspense>
            }
          />
          <Route
            path="/insights"
            element={
              <Suspense fallback={<div className="p-8 text-center text-neutral-500">Loading insights…</div>}>
                <Insights />
              </Suspense>
            }
          />
        </Routes>
      </main>
    </div>
  )
}
