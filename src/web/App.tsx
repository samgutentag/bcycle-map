import { Routes, Route, Link } from 'react-router-dom'
import LiveMap from './routes/LiveMap'
import Explore from './routes/Explore'

export default function App() {
  return (
    <div className="min-h-screen flex flex-col bg-neutral-50 text-neutral-900">
      <header className="px-4 py-3 border-b border-neutral-200 bg-white flex items-center gap-4">
        <h1 className="font-semibold">bcycle-map</h1>
        <nav className="flex gap-3 text-sm text-neutral-700">
          <Link to="/" className="hover:underline">Live</Link>
          <Link to="/explore" className="hover:underline">Explore</Link>
        </nav>
      </header>
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<LiveMap />} />
          <Route path="/station/:stationId" element={<LiveMap />} />
          <Route path="/explore" element={<Explore />} />
        </Routes>
      </main>
    </div>
  )
}
