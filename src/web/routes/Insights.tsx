import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Box,
  Flex,
  IconArrowLeft,
  Paper,
  SegmentedControl,
  Tag,
  Text,
  useTheme,
} from '@audius/harmony'
import { useInsights, type BeaconEvent } from '../hooks/useInsights'
import { normalizePath } from '@shared/path-patterns'
import MiniLine from '../components/MiniLine'
import { useStableVerb } from '../lib/spinner-verbs'

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
    <Paper p="m" borderRadius="m" shadow="near" border="default" direction="column" gap="2xs">
      <Text variant="label" size="xs" strength="strong" color="subdued" textTransform="uppercase">
        {label}
      </Text>
      <Text variant="display" size="s" strength="strong" color="heading" lineHeight="single">
        {value}
      </Text>
      {sublabel && (
        <Text variant="body" size="xs" color="subdued">{sublabel}</Text>
      )}
    </Paper>
  )
}

function CountTable({
  title,
  rows,
  emptyText,
  valueLabel = 'views',
}: { title: string; rows: Array<[string, number]>; emptyText: string; valueLabel?: string }) {
  const theme = useTheme()
  return (
    <Paper p="m" borderRadius="m" shadow="near" border="default" direction="column" gap="s">
      <Text variant="title" size="s" strength="strong" color="heading">{title}</Text>
      {rows.length === 0 ? (
        <Text variant="body" size="xs" color="subdued">{emptyText}</Text>
      ) : (
        <Box as="table" css={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th css={{ textAlign: 'left', padding: '4px 0', borderBottom: `1px solid ${theme.color.border.default}` }}>
                <Text variant="label" size="xs" color="subdued">Key</Text>
              </th>
              <th css={{ textAlign: 'right', padding: '4px 0', borderBottom: `1px solid ${theme.color.border.default}` }}>
                <Text variant="label" size="xs" color="subdued">{valueLabel}</Text>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td css={{ padding: '6px 8px 6px 0', borderBottom: `1px solid ${theme.color.border.default}` }}>
                  <code
                    title={k}
                    css={{
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      fontSize: 12,
                      color: theme.color.text.default,
                      display: 'block',
                      maxWidth: 280,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {k}
                  </code>
                </td>
                <td css={{
                  padding: '6px 0',
                  textAlign: 'right',
                  borderBottom: `1px solid ${theme.color.border.default}`,
                  fontVariantNumeric: 'tabular-nums',
                  color: theme.color.text.heading,
                }}>
                  {v}
                </td>
              </tr>
            ))}
          </tbody>
        </Box>
      )}
    </Paper>
  )
}

export default function Insights() {
  const theme = useTheme()
  const [window, setWindow] = useState<Window>('7d')
  const days = WINDOW_DAYS[window]
  const insights = useInsights(30)
  const verb = useStableVerb()

  const filtered = useMemo(() => {
    if (!insights.data) return []
    return filterToWindow(insights.data.events, days)
  }, [insights.data, days])

  const totalViews = filtered.length
  const uniqueSessions = useMemo(() => new Set(filtered.map(e => e.session ?? '(none)')).size, [filtered])
  const distinctPaths = useMemo(() => new Set(filtered.map(e => normalizePath(e.path))).size, [filtered])

  const timeBuckets = useMemo(() => {
    if (days <= 1) return { values: bucketByHour(filtered, 24), label: 'Views per hour (last 24h)' }
    return { values: bucketByDay(filtered, days), label: `Views per day (last ${days}d)` }
  }, [filtered, days])

  const topPaths = useMemo(() => topNBy(filtered, e => normalizePath(e.path), 10), [filtered])
  const topReferrers = useMemo(() => topNBy(filtered, e => {
    if (!e.referrer) return null
    try { const u = new URL(e.referrer); return u.hostname || '(direct)' } catch { return '(invalid)' }
  }, 10), [filtered])
  const topCountries = useMemo(() => topNBy(filtered, e => e.country, 10), [filtered])
  const topViewports = useMemo(() => topNBy(filtered, e => {
    if (!e.viewport) return null
    const [w] = e.viewport.split('x')
    const width = Number(w)
    if (Number.isNaN(width)) return e.viewport
    if (width < 640) return 'mobile (<640px)'
    if (width < 1024) return 'tablet (640–1024px)'
    return 'desktop (≥1024px)'
  }, 5), [filtered])

  const max = Math.max(1, ...timeBuckets.values)

  return (
    <Flex
      direction="column"
      gap="l"
      css={{
        maxWidth: 1280,
        margin: '0 auto',
        padding: `${theme.spacing.l}px ${theme.spacing.l}px ${theme.spacing['3xl']}px`,
        '@media (max-width: 600px)': {
          padding: `${theme.spacing.m}px ${theme.spacing.s}px ${theme.spacing.xl}px`,
        },
      }}
    >
      <Flex alignItems="flex-start" justifyContent="space-between" gap="m" wrap="wrap">
        <Flex direction="column" gap="xs">
          <Flex alignItems="center" gap="s">
            <Text
              variant="display"
              size="s"
              strength="strong"
              color="heading"
              css={{ '@media (max-width: 600px)': { fontSize: 24, lineHeight: '1.2' } }}
            >Insights</Text>
            <Tag>Private</Tag>
          </Flex>
          <Text variant="body" size="s" color="subdued">
            How people are using the site. URL-only, not linked from the nav — share with care.
          </Text>
        </Flex>
        <SegmentedControl
          options={[
            { key: '24h', text: '24h' },
            { key: '7d', text: '7d' },
            { key: '30d', text: '30d' },
          ]}
          selected={window}
          onSelectOption={(k) => setWindow(k as Window)}
        />
      </Flex>

      {insights.error && (
        <Paper p="m" borderRadius="m" border="default" css={{ background: theme.color.background.surface1 }}>
          <pre css={{
            margin: 0,
            fontSize: 12,
            color: theme.color.text.danger,
            whiteSpace: 'pre-wrap',
          }}>{insights.error.message}</pre>
        </Paper>
      )}

      {insights.loading && !insights.data && (
        <Flex justifyContent="center" alignItems="center" css={{ padding: '48px 0' }}>
          <Text variant="body" size="s" color="subdued">{verb}</Text>
        </Flex>
      )}

      {insights.data && totalViews === 0 && (
        <Paper p="xl" borderRadius="m" border="default" alignItems="center" justifyContent="center" direction="column" gap="xs">
          <Text variant="title" size="s" strength="strong" color="default">
            No views in {WINDOW_LABEL[window].toLowerCase()}
          </Text>
          <Text variant="body" size="xs" color="subdued" textAlign="center">
            Beacons get written from prod only. If you've only been on dev, that's why. Switch to a wider window or visit the live site.
          </Text>
        </Paper>
      )}

      {insights.data && totalViews > 0 && (
        <>
          <Flex gap="s" css={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            '@media (min-width: 768px)': { gridTemplateColumns: 'repeat(4, 1fr)' },
          }}>
            <StatCard label="Page views" value={totalViews} sublabel={WINDOW_LABEL[window]} />
            <StatCard label="Unique sessions" value={uniqueSessions} sublabel="distinct browser tabs" />
            <StatCard label="Routes visited" value={distinctPaths} sublabel="normalized patterns" />
            <StatCard
              label="Views/session"
              value={uniqueSessions === 0 ? '—' : (totalViews / uniqueSessions).toFixed(1)}
              sublabel="average click-around depth"
            />
          </Flex>

          <Paper p="m" borderRadius="m" shadow="near" border="default" direction="column" gap="s">
            <Text variant="title" size="s" strength="strong" color="heading">{timeBuckets.label}</Text>
            <Text variant="body" size="xs" color="subdued">
              Each bar is one {days <= 1 ? 'hour' : 'day'}. The line is the same series as a sparkline for shape.
            </Text>
            <Flex alignItems="flex-end" gap="2xs" css={{ height: 96 }}>
              {timeBuckets.values.map((v, i) => {
                const pct = (v / max) * 100
                return (
                  <Box
                    key={i}
                    title={`${v} views`}
                    css={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'flex-end',
                      alignItems: 'stretch',
                    }}
                  >
                    <Box
                      css={{
                        width: '100%',
                        height: `${pct}%`,
                        minHeight: v > 0 ? 2 : 0,
                        background: theme.color.background.accent,
                        borderTopLeftRadius: 2,
                        borderTopRightRadius: 2,
                      }}
                    />
                  </Box>
                )
              })}
            </Flex>
            <MiniLine values={timeBuckets.values} color="#0d6cb0" width={600} height={32} />
          </Paper>

          <Box css={{
            display: 'grid',
            gridTemplateColumns: '1fr',
            gap: theme.spacing.m,
            '@media (min-width: 1024px)': { gridTemplateColumns: 'repeat(2, 1fr)' },
          }}>
            <CountTable title="Top routes (normalized)" rows={topPaths} emptyText="No path data yet." />
            <CountTable title="Top referrers" rows={topReferrers} emptyText="No referrer data — most visits are direct." />
            <CountTable title="Country breakdown" rows={topCountries} emptyText="No country data." />
            <CountTable title="Viewport size" rows={topViewports} emptyText="No viewport data." />
          </Box>
        </>
      )}

      <Flex alignItems="center" gap="xs" css={{ paddingTop: theme.spacing.m }}>
        <Link
          to="/"
          css={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            color: theme.color.text.accent,
            textDecoration: 'none',
            fontSize: 13,
            '&:hover': { textDecoration: 'underline' },
          }}
        >
          <IconArrowLeft size="s" color="accent" /> Back to live map
        </Link>
        <Text tag="span" variant="body" size="xs" color="subdued">·</Text>
        <Text variant="body" size="xs" color="subdued">
          Data captured via best-effort beacons on route changes. Stored in R2 as daily aggregates. Retained for the last 90 days.
        </Text>
      </Flex>
    </Flex>
  )
}
