import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useInsights, type BeaconEvent } from '../hooks/useInsights'
import { normalizePath } from '@shared/path-patterns'
import MiniLine from '../components/MiniLine'

type Window = '24h' | '7d' | '30d'
const WINDOW_DAYS: Record<Window, number> = { '24h': 1, '7d': 7, '30d': 30 }
const WINDOW_LABEL: Record<Window, string> = { '24h': 'Last 24 hours', '7d': 'Last 7 days', '30d': 'Last 30 days' }

function filterToWindow(events: BeaconEvent[], windowDays: number): BeaconEvent[] {
  const nowSec = Math.floor(Date.now() / 1000)
  const cutoff = nowSec - windowDays * 86400
  return events.filter(e => e.ts >= cutoff)
}

function topNBy<T extends string | null>(events: BeaconEvent[], extract: (e: BeaconEvent) => T, n: number) {
  const counts = new Map<string, number>()
  for (const e of events) {
    const k = extract(e) ?? '(none)'
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return Array.from(counts.entries()).sort(([, a], [, b]) => b - a).slice(0, n)
}

function bucketByHour(events: BeaconEvent[], hours: number): number[] {
  const nowSec = Math.floor(Date.now() / 1000)
  const bucketStart = (Math.floor(nowSec / 3600) - hours + 1) * 3600
  const buckets = new Array(hours).fill(0)
  for (const e of events) {
    const idx = Math.floor((e.ts - bucketStart) / 3600)
    if (idx >= 0 && idx < hours) buckets[idx] += 1
  }
  return buckets
}

function bucketByDay(events: BeaconEvent[], days: number): number[] {
  const nowDayStart = Math.floor(Date.now() / 86400_000) * 86400
  const bucketStart = nowDayStart - (days - 1) * 86400
  const buckets = new Array(days).fill(0)
  for (const e of events) {
    const idx = Math.floor((e.ts - bucketStart) / 86400)
    if (idx >= 0 && idx < days) buckets[idx] += 1
  }
  return buckets
}

function StatCard({ label, value, sublabel }: { label: string; value: string | number; sublabel?: string }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-neutral-200 px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="text-2xl font-bold leading-tight mt-1">{value}</div>
      {sublabel && <div className="text-xs text-neutral-500 mt-1">{sublabel}</div>}
    </div>
  )
}

function CountTable({ title, rows, emptyText, valueLabel = 'views' }: { title: string; rows: Array<[string, number]>; emptyText: string; valueLabel?: string }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-neutral-200 p-4">
      <h3 className="text-sm font-semibold text-neutral-700 mb-2">{title}</h3>
      {rows.length === 0 ? (
        <div className="text-xs text-neutral-500 py-2">{emptyText}</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-neutral-500 border-b border-neutral-100">
              <th className="text-left font-normal pb-1">Key</th>
              <th className="text-right font-normal pb-1">{valueLabel}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k} className="border-b border-neutral-50 last:border-0">
                <td className="py-1 truncate max-w-[280px]" title={k}>
                  <code className="text-xs text-neutral-700 font-mono">{k}</code>
                </td>
                <td className="py-1 text-right text-neutral-900 tabular-nums">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default function Insights() {
  const [window, setWindow] = useState<Window>('7d')
  const days = WINDOW_DAYS[window]
  const insights = useInsights(30)  // always fetch 30; filter client-side for window

  const filtered = useMemo(() => {
    if (!insights.data) return []
    return filterToWindow(insights.data.events, days)
  }, [insights.data, days])

  const totalViews = filtered.length
  const uniqueSessions = useMemo(() => new Set(filtered.map(e => e.session ?? '(none)')).size, [filtered])
  const distinctPaths = useMemo(() => new Set(filtered.map(e => normalizePath(e.path))).size, [filtered])

  const timeBuckets = useMemo(() => {
    if (days <= 1) return { values: bucketByHour(filtered, 24), label: 'views per hour (last 24h)' }
    return { values: bucketByDay(filtered, days), label: `views per day (last ${days}d)` }
  }, [filtered, days])

  const topPaths = useMemo(() => topNBy(filtered, e => normalizePath(e.path), 10), [filtered])
  const topReferrers = useMemo(() => {
    return topNBy(filtered, e => {
      if (!e.referrer) return null
      try {
        const u = new URL(e.referrer)
        return u.hostname || '(direct)'
      } catch {
        return '(invalid)'
      }
    }, 10)
  }, [filtered])
  const topCountries = useMemo(() => topNBy(filtered, e => e.country, 10), [filtered])
  const topViewports = useMemo(() => {
    return topNBy(filtered, e => {
      if (!e.viewport) return null
      const [w] = e.viewport.split('x')
      const width = Number(w)
      if (Number.isNaN(width)) return e.viewport
      if (width < 640) return 'mobile (<640px)'
      if (width < 1024) return 'tablet (640–1024px)'
      return 'desktop (≥1024px)'
    }, 5)
  }, [filtered])

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-2xl font-semibold text-neutral-900">Insights</h2>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500 border border-neutral-300 rounded px-1.5 py-0.5">private</span>
          </div>
          <p className="text-sm text-neutral-600">
            How people are using the site. URL-only, not linked from the nav — share with care.
          </p>
        </div>
        <div className="flex gap-1 text-xs">
          {(['24h', '7d', '30d'] as Window[]).map(w => (
            <button
              key={w}
              type="button"
              onClick={() => setWindow(w)}
              className={`px-3 py-1.5 rounded-md border ${window === w
                ? 'bg-neutral-900 text-white border-neutral-900'
                : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50'}`}
            >{w}</button>
          ))}
        </div>
      </div>

      {insights.error && (
        <pre className="p-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded whitespace-pre-wrap select-all mb-4">{insights.error.message}</pre>
      )}

      {insights.loading && !insights.data && (
        <div className="text-sm text-neutral-500 py-12 text-center">Loading insights…</div>
      )}

      {insights.data && totalViews === 0 && (
        <div className="mb-6 p-8 text-center bg-neutral-50 border border-dashed border-neutral-300 rounded">
          <div className="text-sm font-medium text-neutral-700">No views in {WINDOW_LABEL[window].toLowerCase()}</div>
          <div className="text-xs text-neutral-500 mt-1">Beacons get written from prod only. If you've only been on dev, that's why. Switch to a wider window or visit the live site.</div>
        </div>
      )}

      {insights.data && totalViews > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard label="Page views" value={totalViews} sublabel={WINDOW_LABEL[window]} />
            <StatCard label="Unique sessions" value={uniqueSessions} sublabel="distinct browser tabs" />
            <StatCard label="Routes visited" value={distinctPaths} sublabel="normalized patterns" />
            <StatCard
              label="Views/session"
              value={uniqueSessions === 0 ? '—' : (totalViews / uniqueSessions).toFixed(1)}
              sublabel="average click-around depth"
            />
          </div>

          <section className="bg-white rounded-lg shadow-sm border border-neutral-200 p-4 mb-6">
            <h3 className="text-sm font-semibold text-neutral-700">{timeBuckets.label}</h3>
            <p className="text-xs text-neutral-500 mt-0.5 mb-3">Each bar is one {days <= 1 ? 'hour' : 'day'}. The line is the same series rendered as a sparkline for shape.</p>
            <div className="flex items-end gap-0.5 h-24">
              {timeBuckets.values.map((v, i) => {
                const max = Math.max(1, ...timeBuckets.values)
                const pct = (v / max) * 100
                return (
                  <div key={i} className="flex-1 flex flex-col items-center justify-end" title={`${v} views`}>
                    <div className="w-full bg-sky-600 rounded-t-sm" style={{ height: `${pct}%`, minHeight: v > 0 ? '2px' : '0' }} />
                  </div>
                )
              })}
            </div>
            <div className="mt-2">
              <MiniLine values={timeBuckets.values} color="#0d6cb0" width={600} height={32} />
            </div>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <CountTable
              title="Top routes (normalized)"
              rows={topPaths}
              emptyText="No path data yet."
            />
            <CountTable
              title="Top referrers"
              rows={topReferrers}
              emptyText="No referrer data — most visits are direct."
            />
            <CountTable
              title="Country breakdown"
              rows={topCountries}
              emptyText="No country data."
              valueLabel="views"
            />
            <CountTable
              title="Viewport size"
              rows={topViewports}
              emptyText="No viewport data."
              valueLabel="views"
            />
          </div>
        </>
      )}

      <div className="mt-8 text-xs text-neutral-500">
        <Link to="/" className="text-sky-700 hover:underline">← Back to live map</Link>
        <span className="mx-2">·</span>
        <span>Data captured via best-effort beacons on route changes. Stored in R2 as daily aggregates. {ANALYTICS_RETENTION_LABEL}.</span>
      </div>
    </div>
  )
}

const ANALYTICS_RETENTION_LABEL = 'Retained for the last 90 days'
