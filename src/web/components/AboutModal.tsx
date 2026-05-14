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
    icon: '💻',
    label: 'GitHub',
    desc: 'View the code',
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
    label: 'Activity',
    desc: 'Recent rides',
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
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto relative">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 w-8 h-8 rounded-full text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 flex items-center justify-center text-xl leading-none"
        >
          ×
        </button>

        <div className="px-6 pt-8 pb-2 text-center">
          <h2 id="about-title" className="text-2xl font-semibold text-neutral-900">bcycle-map</h2>
          <p className="text-amber-600 mt-1">Santa Barbara, CA</p>
        </div>

        <div className="px-8 pt-3 pb-6 text-center">
          <p className="text-neutral-700">
            A live map of Santa Barbara's BCycle bike share, with historical patterns, a route planner, and a feed of recent activity. Find an available bike or an open dock before you walk over.
          </p>
        </div>

        <div className="px-6 pb-6">
          <div className="grid grid-cols-3 gap-3">
            {LINKS.map(l => {
              const cardClass = 'flex flex-col items-center justify-center gap-1 text-center rounded-md bg-neutral-100 hover:bg-neutral-200 transition-colors p-3 aspect-square'
              const body = (
                <>
                  <span aria-hidden className="text-2xl mb-0.5">{l.icon}</span>
                  <span className="text-sm font-semibold text-neutral-900">{l.label}</span>
                  <span className="text-xs text-neutral-500 leading-tight">{l.desc}</span>
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

        <div className="border-t border-neutral-100 px-6 py-4 text-center text-sm text-neutral-500">
          Made by{' '}
          <a
            href="https://www.gutentag.world"
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-600 hover:underline"
          >Sam Gutentag</a>{' '}in Santa Barbara, CA
        </div>
      </div>
    </div>
  )
}
