/**
 * Fuzzy "time ago" for past timestamps. Returns "just now" for <10s,
 * "Ns ago" / "Nm ago" / "Nh ago" / "Nd ago" for larger gaps. Future
 * timestamps (nowSec < tsSec) return "just now" to avoid weird strings
 * if the clock has drifted.
 */
export function formatRelative(tsSec: number, nowSec: number): string {
  const diff = nowSec - tsSec
  if (diff < 10) return 'just now'
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}
