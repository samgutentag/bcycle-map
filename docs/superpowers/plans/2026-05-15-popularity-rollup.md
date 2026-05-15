# Popularity rollup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land issues #8 + #9 by introducing a single popularity rollup artifact on R2 that powers an average-trip-duration badge on `/route` and two leaderboard tiles on `/explore`.

**Architecture:** Refresh `gbfs/{systemId}/popularity.json` every 4 hours via a new build script that re-derives events + trips from the existing station_status parquet partitions and the existing `inferTrips` function in `src/shared/trip-inference.ts`. Web app reads the JSON via a thin hook; no DuckDB-WASM at page load, zero KV ops.

**Tech Stack:** React 18 + TypeScript + Vite, Tailwind (existing badge surfaces) + `@audius/harmony` (Section / Paper / Text on /explore), Vitest + @testing-library/react, parquet-wasm via the existing `src/shared/parquet.ts`, Cloudflare R2 via S3-compatible SDK, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-05-15-popularity-rollup-design.md`

---

## File structure

| Path | Role | Responsibility |
|---|---|---|
| `src/shared/popularity.ts` | new | `Popularity` / `PairStat` types + `lookupPairStat` helper |
| `src/web/hooks/useRoutePopularity.ts` | new | R2 fetch hook, mirrors `useTravelMatrix` |
| `src/web/components/AvgTripDurationBadge.tsx` | new | Tailwind badge — empirical avg + sample count |
| `src/web/components/PopularStationsTile.tsx` | new | Harmony Paper/Stack — top 10 stations leaderboard |
| `src/web/components/PopularRoutesTile.tsx` | new | Harmony Paper/Stack — top 10 routes leaderboard |
| `src/web/routes/RouteCheck.tsx` | modify | Add `useRoutePopularity` + render the avg badge alongside `<TravelTimeBadge>` |
| `src/web/routes/Explore.tsx` | modify | Add `useRoutePopularity` + render the two new tiles after the ActivityLog Section |
| `scripts/compute-popularity.ts` | new | Build script (parquet → events → trips → aggregate → R2) |
| `package.json` | modify | Add `compute-popularity` npm script |
| `.github/workflows/popularity.yml` | new | Cron every 4 hours + manual dispatch |

Tests live next to their module (`*.test.ts(x)`).

---

## Task 1: Feature branch

**Files:** none.

- [ ] **Step 1: Confirm clean tree on `main`**

Run: `git status && git branch --show-current`
Expected: working tree clean, branch is `main`.

- [ ] **Step 2: Create and switch to the feature branch**

Run: `git checkout -b feature/popularity-rollup`
Expected: `Switched to a new branch 'feature/popularity-rollup'`.

---

## Task 2: Popularity types + lookupPairStat helper

**Files:**
- Create: `src/shared/popularity.ts`
- Create: `src/shared/popularity.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/popularity.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { lookupPairStat, type Popularity, type PairStat } from './popularity'

const STAT_A_B: PairStat = { count: 7, mean_sec: 420 }

const POP: Popularity = {
  computedAt: 1_700_000_000,
  windowStartTs: 1_697_400_000,
  windowEndTs: 1_700_000_000,
  topStations: [{ station_id: 's1', count: 50 }],
  topRoutes: [{ from_station_id: 's1', to_station_id: 's2', count: 7 }],
  pairStats: { s1: { s2: STAT_A_B } },
}

describe('lookupPairStat', () => {
  it('returns the stat when it exists', () => {
    expect(lookupPairStat(POP, 's1', 's2')).toBe(STAT_A_B)
  })

  it('returns null when the reverse direction is missing', () => {
    expect(lookupPairStat(POP, 's2', 's1')).toBeNull()
  })

  it('returns null when either id is unknown or popularity is null', () => {
    expect(lookupPairStat(POP, 's1', 'sX')).toBeNull()
    expect(lookupPairStat(POP, 'sX', 's2')).toBeNull()
    expect(lookupPairStat(null, 's1', 's2')).toBeNull()
    expect(lookupPairStat(POP, null, 's2')).toBeNull()
    expect(lookupPairStat(POP, 's1', undefined)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/popularity.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the types + helper**

Create `src/shared/popularity.ts`:

```ts
export type PairStat = {
  /** Number of inferred trips for this directed pair in the window. */
  count: number
  /** Mean trip duration in seconds across those trips. */
  mean_sec: number
}

export type Popularity = {
  computedAt: number
  windowStartTs: number
  windowEndTs: number
  topStations: Array<{ station_id: string; count: number }>
  topRoutes: Array<{ from_station_id: string; to_station_id: string; count: number }>
  pairStats: Record<string, Record<string, PairStat>>
}

export function lookupPairStat(
  popularity: Popularity | null,
  fromId: string | null | undefined,
  toId: string | null | undefined,
): PairStat | null {
  if (!popularity || !fromId || !toId) return null
  return popularity.pairStats[fromId]?.[toId] ?? null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/popularity.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/popularity.ts src/shared/popularity.test.ts
git commit -m "feat(shared): Popularity types + lookupPairStat helper"
```

---

## Task 3: useRoutePopularity hook

**Files:**
- Create: `src/web/hooks/useRoutePopularity.ts`

(No test — mirrors `useRouteCache` and `useTravelMatrix`, which are untested at the hook level. Failures surface through component tests later.)

- [ ] **Step 1: Write the hook**

Create `src/web/hooks/useRoutePopularity.ts`:

```ts
import { useEffect, useState } from 'react'
import type { Popularity } from '@shared/popularity'

export type RoutePopularityState = {
  data: Popularity | null
  loading: boolean
  error: Error | null
}

export function useRoutePopularity(r2Base: string, systemId: string): RoutePopularityState {
  const [data, setData] = useState<Popularity | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    const url = `${r2Base}/gbfs/${systemId}/popularity.json`
    setLoading(true)
    setError(null)
    fetch(url)
      .then(async r => {
        if (!r.ok) throw new Error(`popularity fetch failed: ${r.status}`)
        return r.json() as Promise<Popularity>
      })
      .then(json => {
        if (cancelled) return
        setData(json)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e : new Error(String(e)))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [r2Base, systemId])

  return { data, loading, error }
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/web/hooks/useRoutePopularity.ts
git commit -m "feat(web): useRoutePopularity hook (R2 fetch, mirrors useRouteCache)"
```

---

## Task 4: AvgTripDurationBadge component

**Files:**
- Create: `src/web/components/AvgTripDurationBadge.tsx`
- Create: `src/web/components/AvgTripDurationBadge.test.tsx`

This component matches the **Tailwind** pattern of the existing `src/web/components/TravelTimeBadge.tsx` (which has not been Harmony-migrated). Plain `render` from `@testing-library/react` is fine — no theme wrapper needed.

- [ ] **Step 1: Write the failing test**

Create `src/web/components/AvgTripDurationBadge.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import AvgTripDurationBadge from './AvgTripDurationBadge'

describe('AvgTripDurationBadge', () => {
  it('renders the avg minutes and sample count when count >= 3', () => {
    render(<AvgTripDurationBadge count={5} meanSec={420} />)
    expect(screen.getByText(/avg 7 min/i)).toBeInTheDocument()
    expect(screen.getByText(/over 5 trips/i)).toBeInTheDocument()
  })

  it('renders nothing when count is below the minimum sample threshold', () => {
    const { container } = render(<AvgTripDurationBadge count={2} meanSec={500} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when count is zero', () => {
    const { container } = render(<AvgTripDurationBadge count={0} meanSec={0} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when null inputs are provided', () => {
    const { container } = render(<AvgTripDurationBadge count={null} meanSec={null} />)
    expect(container.firstChild).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/web/components/AvgTripDurationBadge.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `src/web/components/AvgTripDurationBadge.tsx`:

```tsx
type Props = {
  count: number | null
  meanSec: number | null
}

const MIN_SAMPLE_COUNT = 3

export default function AvgTripDurationBadge({ count, meanSec }: Props) {
  if (count === null || meanSec === null) return null
  if (count < MIN_SAMPLE_COUNT) return null

  const minutes = Math.round(meanSec / 60)

  return (
    <div className="inline-flex flex-col items-start px-3 py-2 rounded border bg-sky-50 border-sky-200 text-sky-900">
      <span className="text-sm font-semibold leading-tight">avg {minutes} min</span>
      <span className="text-[10px] uppercase tracking-wide text-sky-700/70">
        over {count} {count === 1 ? 'trip' : 'trips'}
      </span>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/web/components/AvgTripDurationBadge.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/web/components/AvgTripDurationBadge.tsx src/web/components/AvgTripDurationBadge.test.tsx
git commit -m "feat(web): AvgTripDurationBadge — empirical avg duration badge"
```

---

## Task 5: PopularStationsTile component

**Files:**
- Create: `src/web/components/PopularStationsTile.tsx`
- Create: `src/web/components/PopularStationsTile.test.tsx`

This component **uses Harmony primitives** (`Paper`, `Flex`, `Text`, `useTheme`). Tests must use `renderWithTheme` from `src/web/test-utils.tsx`.

- [ ] **Step 1: Write the failing test**

Create `src/web/components/PopularStationsTile.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { renderWithTheme } from '../test-utils'
import PopularStationsTile from './PopularStationsTile'

const STATIONS = [
  { station_id: 's1', name: 'State & Cota' },
  { station_id: 's2', name: 'Anacapa & Haley' },
  { station_id: 's3', name: 'Bath & Mission' },
]

function renderTile(props: React.ComponentProps<typeof PopularStationsTile>) {
  return renderWithTheme(<MemoryRouter>{<PopularStationsTile {...props} />}</MemoryRouter>)
}

describe('PopularStationsTile', () => {
  it('renders the top stations with ranks, names, and counts', () => {
    renderTile({
      top: [
        { station_id: 's1', count: 412 },
        { station_id: 's2', count: 388 },
        { station_id: 's3', count: 301 },
      ],
      stations: STATIONS,
      loading: false,
    })
    expect(screen.getByText('State & Cota')).toBeInTheDocument()
    expect(screen.getByText('Anacapa & Haley')).toBeInTheDocument()
    expect(screen.getByText('Bath & Mission')).toBeInTheDocument()
    expect(screen.getByText('412')).toBeInTheDocument()
    expect(screen.getByText('388')).toBeInTheDocument()
    expect(screen.getByText('301')).toBeInTheDocument()
  })

  it('renders loading state when loading is true', () => {
    renderTile({ top: [], stations: STATIONS, loading: true })
    expect(screen.getByText(/…/)).toBeInTheDocument()
  })

  it('renders empty-state message when not loading but top is empty', () => {
    renderTile({ top: [], stations: STATIONS, loading: false })
    expect(screen.getByText(/no popularity data/i)).toBeInTheDocument()
  })

  it('renders rows as links to station details', () => {
    renderTile({
      top: [{ station_id: 's1', count: 412 }],
      stations: STATIONS,
      loading: false,
    })
    const link = screen.getByRole('link', { name: /state & cota/i })
    expect(link).toHaveAttribute('href', '/station/s1/details')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/web/components/PopularStationsTile.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `src/web/components/PopularStationsTile.tsx`:

```tsx
import { Link } from 'react-router-dom'
import { Flex, Paper, Text } from '@audius/harmony'
import { useStableVerb } from '../lib/spinner-verbs'

type Props = {
  top: Array<{ station_id: string; count: number }>
  stations: Array<{ station_id: string; name: string }>
  loading: boolean
}

export default function PopularStationsTile({ top, stations, loading }: Props) {
  const verb = useStableVerb()
  const nameById = new Map(stations.map(s => [s.station_id, s.name]))

  if (loading) {
    return <Text variant="body" size="s" color="subdued">{verb}</Text>
  }
  if (top.length === 0) {
    return <Text variant="body" size="s" color="subdued">No popularity data yet — check back after the next rollup run.</Text>
  }

  return (
    <Flex direction="column" gap="xs">
      {top.map((row, i) => {
        const name = nameById.get(row.station_id) ?? row.station_id
        return (
          <Paper key={row.station_id} p="s" borderRadius="s" border="default" direction="row" alignItems="center" gap="m">
            <Text variant="body" size="s" color="subdued" css={{ width: 24, textAlign: 'right' }}>{i + 1}.</Text>
            <Link to={`/station/${row.station_id}/details`} style={{ flex: 1, textDecoration: 'none' }}>
              <Text variant="body" size="s" color="default">{name}</Text>
            </Link>
            <Text variant="body" size="s" strength="strong" color="heading">{row.count}</Text>
          </Paper>
        )
      })}
    </Flex>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/web/components/PopularStationsTile.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/web/components/PopularStationsTile.tsx src/web/components/PopularStationsTile.test.tsx
git commit -m "feat(web): PopularStationsTile — top stations leaderboard"
```

---

## Task 6: PopularRoutesTile component

**Files:**
- Create: `src/web/components/PopularRoutesTile.tsx`
- Create: `src/web/components/PopularRoutesTile.test.tsx`

Same Harmony pattern as Task 5; renders "from → to" pairs linking to `/route/:from/:to`.

- [ ] **Step 1: Write the failing test**

Create `src/web/components/PopularRoutesTile.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { renderWithTheme } from '../test-utils'
import PopularRoutesTile from './PopularRoutesTile'

const STATIONS = [
  { station_id: 's1', name: 'Capitol' },
  { station_id: 's2', name: 'Library' },
  { station_id: 's3', name: 'Cabrillo' },
]

function renderTile(props: React.ComponentProps<typeof PopularRoutesTile>) {
  return renderWithTheme(<MemoryRouter>{<PopularRoutesTile {...props} />}</MemoryRouter>)
}

describe('PopularRoutesTile', () => {
  it('renders the top routes with ranks, "from → to" names, and counts', () => {
    renderTile({
      top: [
        { from_station_id: 's1', to_station_id: 's2', count: 37 },
        { from_station_id: 's2', to_station_id: 's1', count: 35 },
        { from_station_id: 's1', to_station_id: 's3', count: 28 },
      ],
      stations: STATIONS,
      loading: false,
    })
    expect(screen.getByText(/Capitol.*→.*Library/)).toBeInTheDocument()
    expect(screen.getByText(/Library.*→.*Capitol/)).toBeInTheDocument()
    expect(screen.getByText(/Capitol.*→.*Cabrillo/)).toBeInTheDocument()
    expect(screen.getByText('37')).toBeInTheDocument()
    expect(screen.getByText('35')).toBeInTheDocument()
    expect(screen.getByText('28')).toBeInTheDocument()
  })

  it('renders loading state when loading is true', () => {
    renderTile({ top: [], stations: STATIONS, loading: true })
    expect(screen.getByText(/…/)).toBeInTheDocument()
  })

  it('renders empty-state message when not loading but top is empty', () => {
    renderTile({ top: [], stations: STATIONS, loading: false })
    expect(screen.getByText(/no popularity data/i)).toBeInTheDocument()
  })

  it('renders rows as links to the route page', () => {
    renderTile({
      top: [{ from_station_id: 's1', to_station_id: 's2', count: 37 }],
      stations: STATIONS,
      loading: false,
    })
    const link = screen.getByRole('link', { name: /Capitol.*Library/ })
    expect(link).toHaveAttribute('href', '/route/s1/s2')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/web/components/PopularRoutesTile.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `src/web/components/PopularRoutesTile.tsx`:

```tsx
import { Link } from 'react-router-dom'
import { Flex, Paper, Text } from '@audius/harmony'
import { useStableVerb } from '../lib/spinner-verbs'

type Props = {
  top: Array<{ from_station_id: string; to_station_id: string; count: number }>
  stations: Array<{ station_id: string; name: string }>
  loading: boolean
}

export default function PopularRoutesTile({ top, stations, loading }: Props) {
  const verb = useStableVerb()
  const nameById = new Map(stations.map(s => [s.station_id, s.name]))

  if (loading) {
    return <Text variant="body" size="s" color="subdued">{verb}</Text>
  }
  if (top.length === 0) {
    return <Text variant="body" size="s" color="subdued">No popularity data yet — check back after the next rollup run.</Text>
  }

  return (
    <Flex direction="column" gap="xs">
      {top.map((row, i) => {
        const fromName = nameById.get(row.from_station_id) ?? row.from_station_id
        const toName = nameById.get(row.to_station_id) ?? row.to_station_id
        const label = `${fromName} → ${toName}`
        return (
          <Paper key={`${row.from_station_id}-${row.to_station_id}`} p="s" borderRadius="s" border="default" direction="row" alignItems="center" gap="m">
            <Text variant="body" size="s" color="subdued" css={{ width: 24, textAlign: 'right' }}>{i + 1}.</Text>
            <Link to={`/route/${row.from_station_id}/${row.to_station_id}`} style={{ flex: 1, textDecoration: 'none' }}>
              <Text variant="body" size="s" color="default">{label}</Text>
            </Link>
            <Text variant="body" size="s" strength="strong" color="heading">{row.count}</Text>
          </Paper>
        )
      })}
    </Flex>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/web/components/PopularRoutesTile.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/web/components/PopularRoutesTile.tsx src/web/components/PopularRoutesTile.test.tsx
git commit -m "feat(web): PopularRoutesTile — top routes leaderboard"
```

---

## Task 7: Wire AvgTripDurationBadge into RouteCheck

**Files:**
- Modify: `src/web/routes/RouteCheck.tsx`

- [ ] **Step 1: Add imports at the top**

Append to the import block at the top of `src/web/routes/RouteCheck.tsx`:

```ts
import { useRoutePopularity } from '../hooks/useRoutePopularity'
import { lookupPairStat } from '@shared/popularity'
import AvgTripDurationBadge from '../components/AvgTripDurationBadge'
```

- [ ] **Step 2: Add the hook call**

Find the existing `const matrix = useTravelMatrix(R2_BASE, SYSTEM_ID)` line (~line 41). Add this immediately below it:

```ts
const popularity = useRoutePopularity(R2_BASE, SYSTEM_ID)
```

- [ ] **Step 3: Render the badge next to `<TravelTimeBadge>`**

Find the existing `<TravelTimeBadge ... />` JSX (lines 197–203 per recon). Immediately after its closing `/>`, on the next line, insert:

```tsx
<AvgTripDurationBadge
  count={lookupPairStat(popularity.data, startId, endId)?.count ?? null}
  meanSec={lookupPairStat(popularity.data, startId, endId)?.mean_sec ?? null}
/>
```

Match the surrounding indentation.

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 5: Run the full web test suite**

Run: `npx vitest run src/web`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/web/routes/RouteCheck.tsx
git commit -m "feat(web): show empirical avg trip duration on /route when count >= 3"
```

---

## Task 8: Wire the two tiles into Explore

**Files:**
- Modify: `src/web/routes/Explore.tsx`

- [ ] **Step 1: Add imports**

Append to the import block at the top of `src/web/routes/Explore.tsx`:

```ts
import { useRoutePopularity } from '../hooks/useRoutePopularity'
import PopularStationsTile from '../components/PopularStationsTile'
import PopularRoutesTile from '../components/PopularRoutesTile'
```

- [ ] **Step 2: Add the hook call**

Inside the `Explore` component function, after the existing `const matrix = useTravelMatrix(R2_BASE, SYSTEM_ID)` line (around line 28), add:

```ts
const popularity = useRoutePopularity(R2_BASE, SYSTEM_ID)
```

- [ ] **Step 3: Add two new Sections after the ActivityLog Section**

Find the closing `</Section>` of the ActivityLog section (around line 178 per recon). Immediately after it, insert these two Section blocks (as siblings, before the existing "Active riders" Section that starts around line 180):

```tsx
<Section title="Popular stations · 30 days">
  <PopularStationsTile
    top={popularity.data?.topStations ?? []}
    stations={live?.stations.map(s => ({ station_id: s.station_id, name: s.name })) ?? []}
    loading={popularity.loading}
  />
</Section>

<Section title="Popular routes · 30 days">
  <PopularRoutesTile
    top={popularity.data?.topRoutes ?? []}
    stations={live?.stations.map(s => ({ station_id: s.station_id, name: s.name })) ?? []}
    loading={popularity.loading}
  />
</Section>
```

- [ ] **Step 4: Run typecheck and tests**

```bash
npx tsc --noEmit
npx vitest run src/web
```

Expected: typecheck clean, all tests pass.

- [ ] **Step 5: Build**

Run: `npm run build:web`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/web/routes/Explore.tsx
git commit -m "feat(web): popular stations + popular routes tiles on /explore"
```

---

## Task 9: compute-popularity build script

**Files:**
- Create: `scripts/compute-popularity.ts`

The script imports `inferTrips` from `src/shared/trip-inference.ts` (line 35) and **`parquetToSnapshots`** from `src/shared/parquet.ts` (line 84) — that helper takes a parquet `Uint8Array` and returns an array of `{ snapshot_ts: number; station: StationSnapshot }`. R2 access uses the same S3-compatible client pattern as `scripts/compute-routes.ts` (imports `S3Client`, `GetObjectCommand`, `PutObjectCommand`, `ListObjectsV2Command`). Reads `travel-times.json` from R2 first (the trip inference algorithm needs the matrix for duration-validity bounds).

- [ ] **Step 1: Write the script**

Create `scripts/compute-popularity.ts`:

```ts
import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { parquetToSnapshots, type SnapshotRow } from '../src/shared/parquet'
import { inferTrips, type SimpleMatrix } from '../src/shared/trip-inference'
import type { ActivityEvent, Trip } from '../src/shared/types'
import type { Popularity, PairStat } from '../src/shared/popularity'

const WINDOW_DAYS = 30
const TOP_N = 10

type Env = {
  CF_ACCOUNT_ID?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
  R2_BUCKET?: string
  SYSTEM_ID?: string
}

function requireEnv(env: Env, key: keyof Env): string {
  const v = env[key]
  if (!v) throw new Error(`Missing env var: ${key}`)
  return v
}

function partitionKeyToTs(key: string): number | null {
  const m = key.match(/dt=(\d{4})-(\d{2})-(\d{2})\/(\d{2})\.parquet$/)
  if (!m) return null
  const [, y, mo, d, h] = m
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h)) / 1000
}

async function listPartitionsInWindow(
  s3: S3Client,
  bucket: string,
  systemId: string,
  fromTs: number,
  toTs: number,
): Promise<string[]> {
  const prefix = `gbfs/${systemId}/station_status/`
  const keys: string[] = []
  let token: string | undefined
  do {
    const result = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: token,
    }))
    for (const obj of result.Contents ?? []) {
      const key = obj.Key
      if (!key) continue
      const ts = partitionKeyToTs(key)
      if (ts === null) continue
      if (ts >= fromTs - 3600 && ts <= toTs + 3600) keys.push(key)
    }
    token = result.IsTruncated ? result.NextContinuationToken : undefined
  } while (token)
  return keys.sort()
}

async function fetchTravelMatrix(s3: S3Client, bucket: string, systemId: string): Promise<SimpleMatrix> {
  const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: `gbfs/${systemId}/travel-times.json` }))
  const text = await r.Body!.transformToString()
  const json = JSON.parse(text) as { edges: SimpleMatrix }
  return json.edges
}

async function readPartition(s3: S3Client, bucket: string, key: string): Promise<SnapshotRow[]> {
  const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  const buf = new Uint8Array(await r.Body!.transformToByteArray())
  return parquetToSnapshots(buf)
}

function synthesizeEvents(rows: SnapshotRow[]): ActivityEvent[] {
  const byStation = new Map<string, SnapshotRow[]>()
  for (const row of rows) {
    const id = row.station.station_id
    if (!byStation.has(id)) byStation.set(id, [])
    byStation.get(id)!.push(row)
  }
  const events: ActivityEvent[] = []
  for (const list of byStation.values()) {
    list.sort((a, b) => a.snapshot_ts - b.snapshot_ts)
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1]!
      const curr = list[i]!
      const delta = curr.station.num_bikes_available - prev.station.num_bikes_available
      if (delta === 0) continue
      if (delta < 0) {
        events.push({ ts: curr.snapshot_ts, station_id: curr.station.station_id, type: 'departure', delta: -delta })
      } else {
        events.push({ ts: curr.snapshot_ts, station_id: curr.station.station_id, type: 'arrival', delta })
      }
    }
  }
  events.sort((a, b) => a.ts - b.ts)
  return events
}

function aggregate(events: ActivityEvent[], trips: Trip[]): {
  stationCounts: Map<string, number>
  pairAgg: Map<string, Map<string, { count: number; durationSum: number }>>
} {
  const stationCounts = new Map<string, number>()
  for (const e of events) {
    stationCounts.set(e.station_id, (stationCounts.get(e.station_id) ?? 0) + e.delta)
  }
  const pairAgg = new Map<string, Map<string, { count: number; durationSum: number }>>()
  for (const t of trips) {
    let row = pairAgg.get(t.from_station_id)
    if (!row) { row = new Map(); pairAgg.set(t.from_station_id, row) }
    let cell = row.get(t.to_station_id)
    if (!cell) { cell = { count: 0, durationSum: 0 }; row.set(t.to_station_id, cell) }
    cell.count++
    cell.durationSum += t.duration_sec
  }
  return { stationCounts, pairAgg }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const env = process.env as Env
    const systemId = requireEnv(env, 'SYSTEM_ID')
    const bucket = requireEnv(env, 'R2_BUCKET')
    const accountId = requireEnv(env, 'CF_ACCOUNT_ID')
    const accessKeyId = requireEnv(env, 'R2_ACCESS_KEY_ID')
    const secretAccessKey = requireEnv(env, 'R2_SECRET_ACCESS_KEY')

    const s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    })

    const nowTs = Math.floor(Date.now() / 1000)
    const fromTs = nowTs - WINDOW_DAYS * 86400

    console.log(`window: ${WINDOW_DAYS}d, ${new Date(fromTs * 1000).toISOString()} → ${new Date(nowTs * 1000).toISOString()}`)

    const matrix = await fetchTravelMatrix(s3, bucket, systemId)
    console.log(`travel matrix loaded: ${Object.keys(matrix).length} origins`)

    const keys = await listPartitionsInWindow(s3, bucket, systemId, fromTs, nowTs)
    console.log(`partitions in window: ${keys.length}`)
    if (keys.length === 0) throw new Error('no partitions found in window; refusing to overwrite')

    const allRows: SnapshotRow[] = []
    let read = 0
    for (const key of keys) {
      try {
        const rows = await readPartition(s3, bucket, key)
        allRows.push(...rows)
      } catch (e: unknown) {
        console.warn(`skipped ${key}:`, e instanceof Error ? e.message : e)
      }
      read++
      if (read % 25 === 0) console.log(`  read ${read}/${keys.length}`)
    }
    console.log(`total rows: ${allRows.length}`)

    const events = synthesizeEvents(allRows)
    console.log(`synthesized events: ${events.length}`)
    if (events.length === 0) throw new Error('zero events after parsing; refusing to overwrite')

    const trips = inferTrips(events, matrix, [])
    console.log(`inferred trips: ${trips.length}`)

    const { stationCounts, pairAgg } = aggregate(events, trips)

    const topStations = [...stationCounts.entries()]
      .map(([station_id, count]) => ({ station_id, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, TOP_N)

    const flatPairs: Array<{ from_station_id: string; to_station_id: string; count: number }> = []
    const pairStats: Record<string, Record<string, PairStat>> = {}
    for (const [from, row] of pairAgg) {
      pairStats[from] = {}
      for (const [to, { count, durationSum }] of row) {
        pairStats[from][to] = { count, mean_sec: Math.round(durationSum / count) }
        flatPairs.push({ from_station_id: from, to_station_id: to, count })
      }
    }
    const topRoutes = flatPairs.sort((a, b) => b.count - a.count).slice(0, TOP_N)

    const popularity: Popularity = {
      computedAt: nowTs,
      windowStartTs: fromTs,
      windowEndTs: nowTs,
      topStations,
      topRoutes,
      pairStats,
    }

    const key = `gbfs/${systemId}/popularity.json`
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(popularity),
      ContentType: 'application/json',
      CacheControl: 'public, max-age=300',
    }))
    console.log(`wrote ${key}: ${topStations.length} stations, ${topRoutes.length} routes, ${flatPairs.length} pair stats`)
  })().catch(err => {
    console.error('compute-popularity failed:', err)
    process.exit(1)
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Smoke-load the script with missing env vars**

Run: `SYSTEM_ID=bcycle_santabarbara npx tsx scripts/compute-popularity.ts 2>&1 | head -5`
Expected: `Missing env var: R2_BUCKET` (or one of the other R2 vars). Confirms the script loads and imports resolve.

- [ ] **Step 4: Commit**

```bash
git add scripts/compute-popularity.ts
git commit -m "feat(scripts): compute-popularity — 30d rollup of station + pair counts"
```

---

## Task 10: package.json npm script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the `compute-popularity` script**

In `package.json`, alongside the existing `"compute-routes": "tsx scripts/compute-routes.ts"` entry, add:

```json
"compute-popularity": "tsx scripts/compute-popularity.ts"
```

(Add the trailing comma to the previous line if needed to keep the JSON valid.)

- [ ] **Step 2: Verify JSON is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json', 'utf8'))" && echo OK`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(scripts): npm run compute-popularity"
```

---

## Task 11: popularity.yml workflow

**Files:**
- Create: `.github/workflows/popularity.yml`

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/popularity.yml`:

```yaml
name: popularity

on:
  schedule:
    # Every 4 hours
    - cron: '0 */4 * * *'
  workflow_dispatch: {}

permissions:
  contents: read

env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: 'true'

concurrency:
  group: popularity
  cancel-in-progress: false

jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci

      - name: Run popularity script
        run: npx tsx scripts/compute-popularity.ts
        env:
          CF_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          R2_BUCKET: ${{ secrets.R2_BUCKET }}
          SYSTEM_ID: bcycle_santabarbara
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/popularity.yml
git commit -m "ci: popularity workflow — every 4 hours + manual dispatch"
```

---

## Task 12: Final verification + PR

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: PASS, no regressions.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Build**

Run: `npm run build:web`
Expected: build succeeds.

- [ ] **Step 4: Dev server smoke test**

Run: `npm run dev:web` and open `/explore` in a browser. Until the popularity workflow runs against production R2, the two new tiles will show "No popularity data yet" — that's the expected empty state and proves the components render without errors.

Open `/route/<any>/<other>` for any two stations — `<AvgTripDurationBadge>` should render nothing (popularity data missing) and `<TravelTimeBadge>` should still work normally.

- [ ] **Step 5: Push + open PR**

```bash
git push -u origin feature/popularity-rollup
gh pr create \
  --title "feat(web): popularity rollup — avg trip duration + popular stations/routes" \
  --body "$(cat <<'EOF'
## Summary

- New R2 artifact `gbfs/{systemId}/popularity.json` precomputes top stations, top routes, and per-pair duration stats over a rolling 30-day window.
- `/route/:from/:to` shows an empirical `avg N min over M trips` badge alongside the existing typical-time badge when the directed pair has at least 3 observed trips.
- `/explore` gains two new tiles: top stations (departures + arrivals) and top routes (inferred trips), both 30d.
- Refresh cadence: every 4 hours via the new `popularity` workflow.
- Zero KV ops added (rollup is R2-only).

Closes #8 (avg duration) and #9 (popular stations + routes).

Spec: `docs/superpowers/specs/2026-05-15-popularity-rollup-design.md`
Plan: `docs/superpowers/plans/2026-05-15-popularity-rollup.md`

## Test plan

- [x] `npx vitest run` — full suite passes
- [x] `npx tsc --noEmit` — clean
- [x] `npm run build:web` — bundle builds
- [ ] After merge, manually dispatch the `popularity` workflow once. Verify `gbfs/bcycle_santabarbara/popularity.json` lands on R2 with non-empty `topStations`, `topRoutes`, and `pairStats`.
- [ ] Reload `/explore` — two new tiles populated.
- [ ] Reload `/route/<any-popular-pair>` — `AvgTripDurationBadge` visible alongside `TravelTimeBadge`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: After CI passes, dispatch the workflow**

```bash
gh workflow run popularity --repo samgutentag/bcycle-map
```

Watch the run; it should complete in ~2 minutes (reading 30d of parquet + running inference + writing one JSON file).
