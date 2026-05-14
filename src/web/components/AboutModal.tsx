import { useEffect } from 'react'
import { Link } from 'react-router-dom'

type Props = {
  open: boolean
  onClose: () => void
}

type LinkCard = {
  href: string
  icon: string
  label: string
  desc: string
  internal?: boolean
}

const LINKS: LinkCard[] = [
  {
    href: 'https://github.com/samgutentag/bcycle-map',
    icon: '⚙️',
    label: 'Source',
    desc: 'github.com/samgutentag',
  },
  {
    href: 'https://gbfs.bcycle.com/bcycle_santabarbara/gbfs.json',
    icon: '📡',
    label: 'GBFS feed',
    desc: 'Live data origin',
  },
  {
    href: '/activity',
    icon: '🚦',
    label: 'Activity log',
    desc: 'Live + inferred trips',
    internal: true,
  },
  {
    href: 'https://santabarbara.bcycle.com',
    icon: '🚲',
    label: 'BCycle',
    desc: 'Rent a real bike',
  },
  {
    href: 'mailto:bcycle-map@samgutentag.com',
    icon: '✉️',
    label: 'Contact',
    desc: 'Feedback & corrections',
  },
]

export default function AboutModal({ open, onClose }: Props) {
  // Close on Escape, lock body scroll while open
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-neutral-900/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-title"
    >
      <div className="bg-white rounded-lg shadow-xl border border-neutral-200 max-w-lg w-full max-h-[90vh] overflow-y-auto relative">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 w-8 h-8 rounded-full text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 flex items-center justify-center text-xl leading-none"
        >
          ×
        </button>

        <div className="px-6 pt-6 pb-2">
          <div className="flex items-center gap-2">
            <span aria-hidden className="text-2xl">🚲</span>
            <h2 id="about-title" className="text-2xl font-semibold text-neutral-900">bcycle-map</h2>
          </div>
          <p className="text-sm text-neutral-500 mt-0.5">Santa Barbara BCycle — live + history</p>
        </div>

        <div className="px-6 py-2 text-sm text-neutral-700 space-y-3">
          <p>
            A real-time map of Santa Barbara's BCycle bike share system, layered with historical patterns derived from a continuously-polled GBFS feed. Built for the curiosity of "is there a bike at the station I'm walking to right now, and historically is that station ever empty around this time?".
          </p>
          <p>
            The poller fetches the feed every five minutes and writes snapshots to R2 as hourly parquet partitions. The live tab reads from KV, the explore tab queries parquet via DuckDB-WASM in the browser, and the route planner uses a precomputed travel-time matrix from Google Distance Matrix to compare actual against expected ride durations.
          </p>
          <p className="text-xs text-neutral-500">
            Hobby project. No accounts, no cookies. Best viewed on a phone while standing at a docking station.
          </p>
        </div>

        <div className="px-6 pt-2 pb-6">
          <div className="grid grid-cols-2 gap-2">
            {LINKS.map(l => {
              const cardClass = 'block rounded-md border border-neutral-200 px-3 py-2 hover:border-sky-400 hover:bg-sky-50 transition-colors'
              const body = (
                <>
                  <div className="flex items-center gap-2">
                    <span aria-hidden className="text-lg">{l.icon}</span>
                    <span className="text-sm font-medium text-neutral-900">{l.label}</span>
                  </div>
                  <div className="text-xs text-neutral-500 mt-0.5 truncate">{l.desc}</div>
                </>
              )
              return l.internal ? (
                <Link key={l.href} to={l.href} onClick={onClose} className={cardClass}>{body}</Link>
              ) : (
                <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className={cardClass}>{body}</a>
              )
            })}
          </div>
        </div>

        <div className="px-6 pb-4 text-xs text-neutral-500 border-t border-neutral-100 pt-3 text-center">
          Made by <a href="https://www.gutentag.world" target="_blank" rel="noopener noreferrer" className="text-sky-700 hover:underline">Sam Gutentag</a> in Santa Barbara, CA
        </div>
      </div>
    </div>
  )
}
