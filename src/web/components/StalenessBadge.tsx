type Props = { ageSec: number; snapshotTs: number }

function formatLastUpdate(ts: number): string {
  const d = new Date(ts * 1000)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function StalenessBadge({ ageSec, snapshotTs }: Props) {
  if (ageSec < 180) return null
  if (ageSec <= 600) {
    const minutes = Math.round(ageSec / 60)
    return (
      <div className="absolute top-4 right-4 px-2 py-1 rounded bg-amber-900/70 text-amber-100 text-xs">
        {minutes}m ago
      </div>
    )
  }
  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 px-3 py-2 rounded bg-red-900/80 text-red-50 text-sm">
      feed appears stale, last update at {formatLastUpdate(snapshotTs)}
    </div>
  )
}
