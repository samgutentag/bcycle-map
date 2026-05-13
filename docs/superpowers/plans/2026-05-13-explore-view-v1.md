# /explore View v1 Implementation Plan (Plan 2)

> **For agentic workers:** Use superpowers:subagent-driven-development to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the `/explore` historical-analysis route. Three views: total bikes over time (line), hour-of-week patterns (heatmap), spatial density (deck.gl hex aggregation). All driven by parquet partitions in R2, queried in the browser via DuckDB-WASM.

**Architecture:** Lazy-loaded `/explore` route. `useDuckDB` hook bootstraps DuckDB-WASM in a Web Worker once. Query-specific hooks (`useTotalBikesOverTime`, `useHourOfWeek`, `useStationSnapshots`) wrap it and return `{ data, loading, error }`. Charts are hand-rolled SVG (consistent with the pin markers); the spatial map uses MapLibre + deck.gl `HexagonLayer`.

**Tech stack additions:** `@duckdb/duckdb-wasm`, `deck.gl` (core + layers + aggregation-layers + react). Existing stack otherwise.

**Reference spec:** `docs/superpowers/specs/2026-05-13-explore-view-design.md`

**Scope:** Plan 2. Per-station drill-down is deferred to Plan 3.

---

## File Structure

```
src/web/
├── routes/
│   └── Explore.tsx                    # composes everything
├── components/
│   ├── DateRangePicker.tsx            # preset chips
│   ├── SystemBikesOverTime.tsx        # SVG line chart
│   ├── HourOfWeekHeatmap.tsx          # SVG 7×24 grid
│   └── SpatialDensityMap.tsx          # MapLibre + deck.gl
├── hooks/
│   ├── useDuckDB.ts                   # bootstrap once
│   ├── useTotalBikesOverTime.ts
│   ├── useHourOfWeek.ts
│   └── useStationSnapshots.ts
├── lib/
│   ├── queries.ts                     # SQL builders (pure)
│   ├── date-range.ts                  # preset → [from, to] (pure)
│   └── chart-helpers.ts               # axis ticks, scaling (pure)
└── fixtures/
    └── synthetic-station-status.parquet   # generated for tests
```

## Conventions

- TDD on every testable unit. Skip tests for DuckDB-WASM bootstrap and deck.gl integration (they need a real browser; manual smoke after deploy).
- One commit per task.
- Continue on `main`. The /explore view is purely additive — no risk of breaking the live map.

---

## Task 1: Install dependencies

**Files:** `package.json`, `package-lock.json`

- [ ] **Step 1:** Install DuckDB-WASM and deck.gl
  ```bash
  npm install @duckdb/duckdb-wasm@^1.29.0
  npm install deck.gl@^9.0.0 @deck.gl/core@^9.0.0 @deck.gl/layers@^9.0.0 @deck.gl/aggregation-layers@^9.0.0 @deck.gl/react@^9.0.0
  ```
- [ ] **Step 2:** Verify `npm test` still passes (no behavior change, just new deps in tree)
- [ ] **Step 3:** Commit
  ```bash
  git add package.json package-lock.json
  git commit -m "chore: add DuckDB-WASM and deck.gl for /explore"
  ```

---

## Task 2: Pure date-range helpers (TDD)

**Files:** `src/web/lib/date-range.ts`, `src/web/lib/date-range.test.ts`

The date picker has preset chips. Each preset resolves to a `[fromTs, toTs]` pair in unix seconds. Pure function, easy to test deterministically with a mocked `now`.

- [ ] **Step 1:** Failing test
  ```ts
  // src/web/lib/date-range.test.ts
  import { describe, it, expect } from 'vitest'
  import { resolveRange, type Preset } from './date-range'

  const now = 1778692030  // 2026-05-13 14:13:50 UTC (approx)

  describe('resolveRange', () => {
    it('returns last 24 hours for "24h"', () => {
      const r = resolveRange('24h', now)
      expect(r.toTs).toBe(now)
      expect(r.fromTs).toBe(now - 24 * 3600)
    })

    it('returns last 7 days for "7d"', () => {
      const r = resolveRange('7d', now)
      expect(r.toTs).toBe(now)
      expect(r.fromTs).toBe(now - 7 * 86400)
    })

    it('returns last 30 days for "30d"', () => {
      const r = resolveRange('30d', now)
      expect(r.fromTs).toBe(now - 30 * 86400)
    })

    it('returns project start to now for "all"', () => {
      const r = resolveRange('all', now)
      expect(r.toTs).toBe(now)
      expect(r.fromTs).toBeLessThan(now)
      // project started 2026-05-13 (today); "all" should be at least today
      expect(r.fromTs).toBeGreaterThanOrEqual(1778626800)
    })

    it('lists every preset', () => {
      const presets: Preset[] = ['24h', '7d', '30d', 'all']
      for (const p of presets) {
        expect(() => resolveRange(p, now)).not.toThrow()
      }
    })
  })
  ```

- [ ] **Step 2:** Run, see fail
  ```bash
  npm test -- date-range
  ```

- [ ] **Step 3:** Implement
  ```ts
  // src/web/lib/date-range.ts
  export type Preset = '24h' | '7d' | '30d' | 'all'

  export type Range = { fromTs: number; toTs: number }

  // Project start ts — anchor for "all-time" globs.
  // 2026-05-13 00:00 UTC. Bump if you back-fill earlier data.
  export const PROJECT_START_TS = 1778716800

  export function resolveRange(preset: Preset, nowTs: number): Range {
    switch (preset) {
      case '24h': return { fromTs: nowTs - 24 * 3600, toTs: nowTs }
      case '7d':  return { fromTs: nowTs - 7 * 86400, toTs: nowTs }
      case '30d': return { fromTs: nowTs - 30 * 86400, toTs: nowTs }
      case 'all': return { fromTs: PROJECT_START_TS, toTs: nowTs }
    }
  }
  ```

- [ ] **Step 4:** Run, see pass (5 tests)
- [ ] **Step 5:** Commit
  ```bash
  git add src/web/lib/date-range.ts src/web/lib/date-range.test.ts
  git commit -m "feat(web): date-range preset resolver"
  ```

---

## Task 3: SQL query builders (TDD)

**Files:** `src/web/lib/queries.ts`, `src/web/lib/queries.test.ts`

Pure functions: input a date range, output a SQL string. Tests assert the string contains the expected glob, predicates, and aggregation.

- [ ] **Step 1:** Failing test
  ```ts
  // src/web/lib/queries.test.ts
  import { describe, it, expect } from 'vitest'
  import {
    buildTotalBikesQuery,
    buildHourOfWeekQuery,
    buildStationSnapshotsQuery,
    daysCovered,
  } from './queries'

  describe('daysCovered', () => {
    it('returns one date for a same-day range', () => {
      const days = daysCovered(1778716800, 1778716800 + 100)
      expect(days).toEqual(['2026-05-13'])
    })

    it('returns each UTC date in the range', () => {
      const days = daysCovered(1778716800, 1778716800 + 2 * 86400 + 100)
      expect(days).toEqual(['2026-05-13', '2026-05-14', '2026-05-15'])
    })
  })

  describe('buildTotalBikesQuery', () => {
    it('aggregates by snapshot_ts and filters by the range', () => {
      const sql = buildTotalBikesQuery({
        baseUrl: 'https://example.r2.dev',
        system: 'bcycle_santabarbara',
        range: { fromTs: 1778716800, toTs: 1778716800 + 100 },
      })
      expect(sql).toContain('SUM(num_bikes_available)')
      expect(sql).toContain('GROUP BY snapshot_ts')
      expect(sql).toContain('ORDER BY snapshot_ts')
      expect(sql).toContain('bcycle_santabarbara')
      expect(sql).toContain('1778716800')
      expect(sql).toContain('2026-05-13')
    })
  })

  describe('buildHourOfWeekQuery', () => {
    it('groups by dow and hod', () => {
      const sql = buildHourOfWeekQuery({
        baseUrl: 'https://example.r2.dev',
        system: 'bcycle_santabarbara',
        range: { fromTs: 1778716800, toTs: 1778716800 + 7 * 86400 },
      })
      expect(sql).toContain("date_part('dow'")
      expect(sql).toContain("date_part('hour'")
      expect(sql).toContain('GROUP BY')
      expect(sql).toContain('AVG(num_bikes_available)')
    })
  })

  describe('buildStationSnapshotsQuery', () => {
    it('selects the latest snapshot per station at a given moment', () => {
      const sql = buildStationSnapshotsQuery({
        baseUrl: 'https://example.r2.dev',
        system: 'bcycle_santabarbara',
        atTs: 1778716800 + 3600,
      })
      expect(sql).toContain('station_id')
      expect(sql).toContain('lat')
      expect(sql).toContain('lon')
      expect(sql).toContain('num_bikes_available')
      expect(sql).toContain('2026-05-13')
    })
  })
  ```

- [ ] **Step 2:** Run, see fail
- [ ] **Step 3:** Implement
  ```ts
  // src/web/lib/queries.ts
  import type { Range } from './date-range'

  export type QueryArgs = {
    baseUrl: string
    system: string
    range: Range
  }

  /**
   * Returns an array of UTC date strings (YYYY-MM-DD) covering every day
   * in the [fromTs, toTs] range, inclusive on both ends.
   */
  export function daysCovered(fromTs: number, toTs: number): string[] {
    const fromDay = Math.floor(fromTs / 86400) * 86400
    const toDay = Math.floor(toTs / 86400) * 86400
    const days: string[] = []
    for (let day = fromDay; day <= toDay; day += 86400) {
      const d = new Date(day * 1000)
      const yyyy = d.getUTCFullYear()
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
      const dd = String(d.getUTCDate()).padStart(2, '0')
      days.push(`${yyyy}-${mm}-${dd}`)
    }
    return days
  }

  function partitionGlob(baseUrl: string, system: string, range: Range): string {
    const days = daysCovered(range.fromTs, range.toTs)
    if (days.length === 1) {
      return `${baseUrl}/gbfs/${system}/station_status/dt=${days[0]}/*.parquet`
    }
    // DuckDB supports a list of paths
    const paths = days.map(d => `'${baseUrl}/gbfs/${system}/station_status/dt=${d}/*.parquet'`).join(', ')
    return `[${paths}]`
  }

  export function buildTotalBikesQuery(args: QueryArgs): string {
    const src = partitionGlob(args.baseUrl, args.system, args.range)
    const ref = args.range.fromTs && args.range.toTs ? src : src
    return `
      SELECT snapshot_ts, SUM(num_bikes_available) as total_bikes
      FROM read_parquet(${ref})
      WHERE snapshot_ts BETWEEN ${args.range.fromTs} AND ${args.range.toTs}
      GROUP BY snapshot_ts
      ORDER BY snapshot_ts
    `.trim()
  }

  export function buildHourOfWeekQuery(args: QueryArgs): string {
    const src = partitionGlob(args.baseUrl, args.system, args.range)
    return `
      SELECT
        date_part('dow', to_timestamp(snapshot_ts)) as dow,
        date_part('hour', to_timestamp(snapshot_ts)) as hod,
        AVG(num_bikes_available) as avg_bikes,
        COUNT(*) as samples
      FROM read_parquet(${src})
      WHERE snapshot_ts BETWEEN ${args.range.fromTs} AND ${args.range.toTs}
      GROUP BY dow, hod
      ORDER BY dow, hod
    `.trim()
  }

  export function buildStationSnapshotsQuery(args: {
    baseUrl: string
    system: string
    atTs: number
  }): string {
    const d = new Date(args.atTs * 1000)
    const yyyy = d.getUTCFullYear()
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(d.getUTCDate()).padStart(2, '0')
    const date = `${yyyy}-${mm}-${dd}`
    return `
      WITH partition_data AS (
        SELECT * FROM read_parquet('${args.baseUrl}/gbfs/${args.system}/station_status/dt=${date}/*.parquet')
        WHERE snapshot_ts <= ${args.atTs}
      ),
      latest AS (
        SELECT MAX(snapshot_ts) as ts FROM partition_data
      )
      SELECT station_id, name, lat, lon, num_bikes_available, num_docks_available, snapshot_ts
      FROM partition_data, latest
      WHERE partition_data.snapshot_ts = latest.ts
      ORDER BY station_id
    `.trim()
  }
  ```

- [ ] **Step 4:** Run, see pass
- [ ] **Step 5:** Commit
  ```bash
  git add src/web/lib/queries.ts src/web/lib/queries.test.ts
  git commit -m "feat(web): SQL query builders for /explore"
  ```

---

## Task 4: DateRangePicker component (TDD)

**Files:** `src/web/components/DateRangePicker.tsx`, `src/web/components/DateRangePicker.test.tsx`

- [ ] **Step 1:** Failing test
  ```tsx
  // src/web/components/DateRangePicker.test.tsx
  import { describe, it, expect, vi } from 'vitest'
  import { render, screen, fireEvent } from '@testing-library/react'
  import DateRangePicker from './DateRangePicker'

  describe('DateRangePicker', () => {
    it('renders the four preset chips', () => {
      render(<DateRangePicker value="24h" onChange={() => {}} />)
      expect(screen.getByText('24h')).toBeInTheDocument()
      expect(screen.getByText('7d')).toBeInTheDocument()
      expect(screen.getByText('30d')).toBeInTheDocument()
      expect(screen.getByText('All')).toBeInTheDocument()
    })

    it('highlights the currently-selected preset', () => {
      render(<DateRangePicker value="7d" onChange={() => {}} />)
      const seven = screen.getByText('7d').closest('button')
      const day = screen.getByText('24h').closest('button')
      expect(seven?.className).toMatch(/bg-/)
      expect(day?.className).not.toEqual(seven?.className)
    })

    it('calls onChange when a different preset is clicked', () => {
      const onChange = vi.fn()
      render(<DateRangePicker value="24h" onChange={onChange} />)
      fireEvent.click(screen.getByText('30d'))
      expect(onChange).toHaveBeenCalledWith('30d')
    })
  })
  ```

- [ ] **Step 2:** Run, see fail
- [ ] **Step 3:** Implement
  ```tsx
  // src/web/components/DateRangePicker.tsx
  import type { Preset } from '../lib/date-range'

  type Props = {
    value: Preset
    onChange: (preset: Preset) => void
  }

  const PRESETS: { value: Preset; label: string }[] = [
    { value: '24h', label: '24h' },
    { value: '7d', label: '7d' },
    { value: '30d', label: '30d' },
    { value: 'all', label: 'All' },
  ]

  export default function DateRangePicker({ value, onChange }: Props) {
    return (
      <div className="inline-flex gap-1 p-1 bg-neutral-100 rounded-lg border border-neutral-200">
        {PRESETS.map(p => {
          const selected = p.value === value
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => onChange(p.value)}
              className={
                selected
                  ? 'px-3 py-1 text-sm font-medium rounded-md bg-white shadow-sm text-neutral-900'
                  : 'px-3 py-1 text-sm rounded-md text-neutral-600 hover:text-neutral-900'
              }
            >
              {p.label}
            </button>
          )
        })}
      </div>
    )
  }
  ```

- [ ] **Step 4:** Run, see pass
- [ ] **Step 5:** Commit
  ```bash
  git add src/web/components/DateRangePicker.tsx src/web/components/DateRangePicker.test.tsx
  git commit -m "feat(web): DateRangePicker with preset chips"
  ```

---

## Task 5: useDuckDB hook (no tests — browser-only)

**Files:** `src/web/hooks/useDuckDB.ts`

This bootstraps DuckDB-WASM in a Web Worker. It's tested manually in the browser because Vitest/happy-dom doesn't have a real Worker scheduler. The hook returns `{ db: AsyncDuckDBConnection | null, loading: boolean, error: Error | null }`. Only one global instance is created across all `/explore` consumers.

- [ ] **Step 1:** Implement
  ```ts
  // src/web/hooks/useDuckDB.ts
  import { useEffect, useState } from 'react'
  import type { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'

  type State = {
    conn: AsyncDuckDBConnection | null
    loading: boolean
    error: Error | null
  }

  // Singleton promise — first caller initializes, subsequent callers reuse.
  let _connPromise: Promise<AsyncDuckDBConnection> | null = null

  async function initDuckDB(): Promise<AsyncDuckDBConnection> {
    const duckdb = await import('@duckdb/duckdb-wasm')
    const bundles = duckdb.getJsDelivrBundles()
    const bundle = await duckdb.selectBundle(bundles)
    const workerUrl = URL.createObjectURL(
      new Blob([`importScripts("${bundle.mainWorker!}");`], { type: 'text/javascript' })
    )
    const worker = new Worker(workerUrl)
    const logger = new duckdb.ConsoleLogger()
    const db = new duckdb.AsyncDuckDB(logger, worker)
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker)
    const conn = await db.connect()
    await conn.query('INSTALL httpfs; LOAD httpfs;')
    URL.revokeObjectURL(workerUrl)
    return conn
  }

  export function useDuckDB(): State {
    const [conn, setConn] = useState<AsyncDuckDBConnection | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<Error | null>(null)

    useEffect(() => {
      let cancelled = false
      if (!_connPromise) _connPromise = initDuckDB()
      _connPromise.then(
        c => { if (!cancelled) { setConn(c); setLoading(false) } },
        e => { if (!cancelled) { setError(e); setLoading(false) } }
      )
      return () => { cancelled = true }
    }, [])

    return { conn, loading, error }
  }
  ```

- [ ] **Step 2:** Typecheck
  ```bash
  npx tsc --noEmit
  ```

- [ ] **Step 3:** Commit
  ```bash
  git add src/web/hooks/useDuckDB.ts
  git commit -m "feat(web): useDuckDB bootstraps WASM database in a Web Worker"
  ```

---

## Task 6: Query hooks (light tests via mocking)

**Files:** `src/web/hooks/useTotalBikesOverTime.ts`, `src/web/hooks/useHourOfWeek.ts`, `src/web/hooks/useStationSnapshots.ts`

Each hook wraps `useDuckDB`, runs a query when the connection is ready, returns `{ data, loading, error }`. Implementation only; tests are deferred to integration smoke after deploy.

- [ ] **Step 1:** Implement `useTotalBikesOverTime`
  ```ts
  // src/web/hooks/useTotalBikesOverTime.ts
  import { useEffect, useState } from 'react'
  import { useDuckDB } from './useDuckDB'
  import { buildTotalBikesQuery } from '../lib/queries'
  import type { Range } from '../lib/date-range'

  export type TotalBikesRow = { snapshot_ts: number; total_bikes: number }

  type Args = { baseUrl: string; system: string; range: Range }

  export function useTotalBikesOverTime(args: Args) {
    const { conn, loading: dbLoading, error: dbError } = useDuckDB()
    const [data, setData] = useState<TotalBikesRow[] | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<Error | null>(null)

    useEffect(() => {
      if (!conn) return
      let cancelled = false
      setLoading(true)
      const sql = buildTotalBikesQuery(args)
      conn.query(sql).then(
        result => {
          if (cancelled) return
          const rows = result.toArray().map((r: any) => ({
            snapshot_ts: Number(r.snapshot_ts),
            total_bikes: Number(r.total_bikes),
          }))
          setData(rows)
          setLoading(false)
        },
        e => {
          if (cancelled) return
          setError(e as Error)
          setLoading(false)
        }
      )
      return () => { cancelled = true }
    }, [conn, args.baseUrl, args.system, args.range.fromTs, args.range.toTs])

    return { data, loading: dbLoading || loading, error: dbError || error }
  }
  ```

- [ ] **Step 2:** Implement `useHourOfWeek` (same shape; different query and row type)
  ```ts
  // src/web/hooks/useHourOfWeek.ts
  import { useEffect, useState } from 'react'
  import { useDuckDB } from './useDuckDB'
  import { buildHourOfWeekQuery } from '../lib/queries'
  import type { Range } from '../lib/date-range'

  export type HourOfWeekRow = {
    dow: number
    hod: number
    avg_bikes: number
    samples: number
  }

  type Args = { baseUrl: string; system: string; range: Range }

  export function useHourOfWeek(args: Args) {
    const { conn, loading: dbLoading, error: dbError } = useDuckDB()
    const [data, setData] = useState<HourOfWeekRow[] | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<Error | null>(null)

    useEffect(() => {
      if (!conn) return
      let cancelled = false
      setLoading(true)
      const sql = buildHourOfWeekQuery(args)
      conn.query(sql).then(
        result => {
          if (cancelled) return
          const rows = result.toArray().map((r: any) => ({
            dow: Number(r.dow),
            hod: Number(r.hod),
            avg_bikes: Number(r.avg_bikes),
            samples: Number(r.samples),
          }))
          setData(rows)
          setLoading(false)
        },
        e => {
          if (cancelled) return
          setError(e as Error)
          setLoading(false)
        }
      )
      return () => { cancelled = true }
    }, [conn, args.baseUrl, args.system, args.range.fromTs, args.range.toTs])

    return { data, loading: dbLoading || loading, error: dbError || error }
  }
  ```

- [ ] **Step 3:** Implement `useStationSnapshots` (point-in-time snapshot at `atTs`)
  ```ts
  // src/web/hooks/useStationSnapshots.ts
  import { useEffect, useState } from 'react'
  import { useDuckDB } from './useDuckDB'
  import { buildStationSnapshotsQuery } from '../lib/queries'

  export type StationSnapshotRow = {
    station_id: string
    name: string
    lat: number
    lon: number
    num_bikes_available: number
    num_docks_available: number
    snapshot_ts: number
  }

  type Args = { baseUrl: string; system: string; atTs: number }

  export function useStationSnapshots(args: Args) {
    const { conn, loading: dbLoading, error: dbError } = useDuckDB()
    const [data, setData] = useState<StationSnapshotRow[] | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<Error | null>(null)

    useEffect(() => {
      if (!conn) return
      let cancelled = false
      setLoading(true)
      const sql = buildStationSnapshotsQuery(args)
      conn.query(sql).then(
        result => {
          if (cancelled) return
          const rows = result.toArray().map((r: any) => ({
            station_id: String(r.station_id),
            name: String(r.name),
            lat: Number(r.lat),
            lon: Number(r.lon),
            num_bikes_available: Number(r.num_bikes_available),
            num_docks_available: Number(r.num_docks_available),
            snapshot_ts: Number(r.snapshot_ts),
          }))
          setData(rows)
          setLoading(false)
        },
        e => {
          if (cancelled) return
          setError(e as Error)
          setLoading(false)
        }
      )
      return () => { cancelled = true }
    }, [conn, args.baseUrl, args.system, args.atTs])

    return { data, loading: dbLoading || loading, error: dbError || error }
  }
  ```

- [ ] **Step 4:** Typecheck, commit
  ```bash
  npx tsc --noEmit
  git add src/web/hooks/useTotalBikesOverTime.ts src/web/hooks/useHourOfWeek.ts src/web/hooks/useStationSnapshots.ts
  git commit -m "feat(web): three query hooks for /explore (over-time, hour-of-week, snapshots)"
  ```

---

## Task 7: SystemBikesOverTime chart (TDD)

**Files:** `src/web/components/SystemBikesOverTime.tsx`, `src/web/components/SystemBikesOverTime.test.tsx`

Hand-rolled SVG line chart. Accepts an array of `{ snapshot_ts, total_bikes }` rows and renders an SVG with:
- X-axis: time, with tick marks at sensible intervals
- Y-axis: total bikes available
- A single polyline through all the points
- Min/max labels

- [ ] **Step 1:** Failing test
  ```tsx
  // src/web/components/SystemBikesOverTime.test.tsx
  import { describe, it, expect } from 'vitest'
  import { render } from '@testing-library/react'
  import SystemBikesOverTime from './SystemBikesOverTime'

  const data = [
    { snapshot_ts: 1778716800, total_bikes: 100 },
    { snapshot_ts: 1778716800 + 120, total_bikes: 95 },
    { snapshot_ts: 1778716800 + 240, total_bikes: 110 },
  ]

  describe('SystemBikesOverTime', () => {
    it('renders an SVG with a polyline', () => {
      const { container } = render(<SystemBikesOverTime data={data} />)
      const svg = container.querySelector('svg')
      const polyline = container.querySelector('polyline')
      expect(svg).toBeInTheDocument()
      expect(polyline).toBeInTheDocument()
      expect(polyline?.getAttribute('points')?.split(' ').length).toBe(3)
    })

    it('renders an empty-state message for zero rows', () => {
      const { container } = render(<SystemBikesOverTime data={[]} />)
      expect(container.textContent).toMatch(/no data/i)
    })

    it('renders y-axis min and max labels', () => {
      const { container } = render(<SystemBikesOverTime data={data} />)
      expect(container.textContent).toContain('110')
      expect(container.textContent).toContain('95')
    })
  })
  ```

- [ ] **Step 2:** Run, see fail
- [ ] **Step 3:** Implement
  ```tsx
  // src/web/components/SystemBikesOverTime.tsx
  type Row = { snapshot_ts: number; total_bikes: number }
  type Props = { data: Row[] }

  const WIDTH = 600
  const HEIGHT = 200
  const PAD = 32

  export default function SystemBikesOverTime({ data }: Props) {
    if (data.length === 0) {
      return <div className="p-8 text-center text-neutral-500">No data for this range.</div>
    }

    const xs = data.map(d => d.snapshot_ts)
    const ys = data.map(d => d.total_bikes)
    const xMin = Math.min(...xs)
    const xMax = Math.max(...xs)
    const yMin = Math.min(...ys)
    const yMax = Math.max(...ys)
    const xSpan = Math.max(1, xMax - xMin)
    const ySpan = Math.max(1, yMax - yMin)

    const scaleX = (t: number) => PAD + ((t - xMin) / xSpan) * (WIDTH - 2 * PAD)
    const scaleY = (v: number) => HEIGHT - PAD - ((v - yMin) / ySpan) * (HEIGHT - 2 * PAD)

    const points = data.map(d => `${scaleX(d.snapshot_ts).toFixed(1)},${scaleY(d.total_bikes).toFixed(1)}`).join(' ')

    return (
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-auto">
        <text x={PAD - 4} y={PAD} textAnchor="end" fontSize="11" fill="#6b7280">{yMax}</text>
        <text x={PAD - 4} y={HEIGHT - PAD + 4} textAnchor="end" fontSize="11" fill="#6b7280">{yMin}</text>
        <line x1={PAD} y1={HEIGHT - PAD} x2={WIDTH - PAD} y2={HEIGHT - PAD} stroke="#e5e7eb" />
        <line x1={PAD} y1={PAD} x2={PAD} y2={HEIGHT - PAD} stroke="#e5e7eb" />
        <polyline fill="none" stroke="#15803d" strokeWidth="2" points={points} />
      </svg>
    )
  }
  ```

- [ ] **Step 4:** Run, see pass
- [ ] **Step 5:** Commit
  ```bash
  git add src/web/components/SystemBikesOverTime.tsx src/web/components/SystemBikesOverTime.test.tsx
  git commit -m "feat(web): SystemBikesOverTime line chart"
  ```

---

## Task 8: HourOfWeekHeatmap chart (TDD)

**Files:** `src/web/components/HourOfWeekHeatmap.tsx`, `src/web/components/HourOfWeekHeatmap.test.tsx`

7-row × 24-column grid. Color of each cell = avg_bikes for that (dow, hod). Missing cells render as a different color.

- [ ] **Step 1:** Failing test
  ```tsx
  // src/web/components/HourOfWeekHeatmap.test.tsx
  import { describe, it, expect } from 'vitest'
  import { render } from '@testing-library/react'
  import HourOfWeekHeatmap from './HourOfWeekHeatmap'

  const data = [
    { dow: 0, hod: 0, avg_bikes: 5, samples: 10 },
    { dow: 0, hod: 1, avg_bikes: 7, samples: 10 },
    { dow: 3, hod: 12, avg_bikes: 2, samples: 10 },
  ]

  describe('HourOfWeekHeatmap', () => {
    it('renders a 7x24 grid (168 cells) in the SVG', () => {
      const { container } = render(<HourOfWeekHeatmap data={data} />)
      const cells = container.querySelectorAll('rect.cell')
      expect(cells.length).toBe(7 * 24)
    })

    it('renders day-of-week labels', () => {
      const { container } = render(<HourOfWeekHeatmap data={data} />)
      expect(container.textContent).toContain('Sun')
      expect(container.textContent).toContain('Sat')
    })

    it('renders empty-state for zero rows', () => {
      const { container } = render(<HourOfWeekHeatmap data={[]} />)
      expect(container.textContent).toMatch(/no data/i)
    })
  })
  ```

- [ ] **Step 2:** Run, see fail
- [ ] **Step 3:** Implement
  ```tsx
  // src/web/components/HourOfWeekHeatmap.tsx
  type Row = { dow: number; hod: number; avg_bikes: number; samples: number }
  type Props = { data: Row[] }

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const CELL = 22
  const LABEL_W = 32
  const HEADER_H = 16
  const WIDTH = LABEL_W + CELL * 24
  const HEIGHT = HEADER_H + CELL * 7

  function colorFor(value: number, min: number, max: number): string {
    if (max === min) return '#e5e7eb'
    const t = (value - min) / (max - min)
    const r = Math.round(229 + (21 - 229) * t)
    const g = Math.round(231 + (128 - 231) * t)
    const b = Math.round(235 + (61 - 235) * t)
    return `rgb(${r}, ${g}, ${b})`
  }

  export default function HourOfWeekHeatmap({ data }: Props) {
    if (data.length === 0) {
      return <div className="p-8 text-center text-neutral-500">No data for this range.</div>
    }

    const lookup = new Map<string, number>()
    for (const r of data) lookup.set(`${r.dow}-${r.hod}`, r.avg_bikes)
    const values = data.map(d => d.avg_bikes)
    const min = Math.min(...values)
    const max = Math.max(...values)

    return (
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-auto">
        {DAYS.map((d, dow) => (
          <text key={d} x={LABEL_W - 6} y={HEADER_H + dow * CELL + CELL * 0.65} textAnchor="end" fontSize="10" fill="#6b7280">
            {d}
          </text>
        ))}
        {[0, 6, 12, 18, 23].map(h => (
          <text key={h} x={LABEL_W + h * CELL + CELL / 2} y={HEADER_H - 4} textAnchor="middle" fontSize="10" fill="#6b7280">
            {h}
          </text>
        ))}
        {Array.from({ length: 7 }).map((_, dow) =>
          Array.from({ length: 24 }).map((_, hod) => {
            const v = lookup.get(`${dow}-${hod}`)
            const fill = v === undefined ? '#f3f4f6' : colorFor(v, min, max)
            return (
              <rect
                key={`${dow}-${hod}`}
                className="cell"
                x={LABEL_W + hod * CELL}
                y={HEADER_H + dow * CELL}
                width={CELL - 1}
                height={CELL - 1}
                fill={fill}
              >
                {v !== undefined && (
                  <title>{`${DAYS[dow]} ${hod}:00 — avg ${v.toFixed(1)} bikes`}</title>
                )}
              </rect>
            )
          })
        )}
      </svg>
    )
  }
  ```

- [ ] **Step 4:** Run, see pass
- [ ] **Step 5:** Commit
  ```bash
  git add src/web/components/HourOfWeekHeatmap.tsx src/web/components/HourOfWeekHeatmap.test.tsx
  git commit -m "feat(web): HourOfWeekHeatmap (7 day-of-week × 24 hour-of-day)"
  ```

---

## Task 9: SpatialDensityMap (no auto tests — browser-only)

**Files:** `src/web/components/SpatialDensityMap.tsx`

MapLibre canvas with a deck.gl `HexagonLayer` overlaying station-snapshot points. Hex bins aggregate `num_bikes_available` per ~200m radius. A time slider drives the `atTs` query that powers the snapshot.

- [ ] **Step 1:** Implement (manual smoke after deploy)
  ```tsx
  // src/web/components/SpatialDensityMap.tsx
  import { useEffect, useRef, useState } from 'react'
  import maplibregl, { Map as MlMap } from 'maplibre-gl'
  import 'maplibre-gl/dist/maplibre-gl.css'
  import { MapboxOverlay } from '@deck.gl/mapbox'
  import { HexagonLayer } from '@deck.gl/aggregation-layers'
  import { useStationSnapshots } from '../hooks/useStationSnapshots'

  const SB_CENTER: [number, number] = [-119.6982, 34.4208]
  const BASEMAP_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'

  type Props = { baseUrl: string; system: string; atTs: number }

  export default function SpatialDensityMap({ baseUrl, system, atTs }: Props) {
    const ref = useRef<HTMLDivElement>(null)
    const mapRef = useRef<MlMap | null>(null)
    const overlayRef = useRef<MapboxOverlay | null>(null)
    const { data, loading } = useStationSnapshots({ baseUrl, system, atTs })

    useEffect(() => {
      if (!ref.current || mapRef.current) return
      const map = new maplibregl.Map({
        container: ref.current,
        style: BASEMAP_STYLE,
        center: SB_CENTER,
        zoom: 13,
      })
      const overlay = new MapboxOverlay({ layers: [] })
      map.addControl(overlay as any)
      mapRef.current = map
      overlayRef.current = overlay
      return () => { map.remove(); mapRef.current = null; overlayRef.current = null }
    }, [])

    useEffect(() => {
      if (!overlayRef.current || !data) return
      const layer = new HexagonLayer({
        id: 'station-hex',
        data,
        getPosition: (d: any) => [d.lon, d.lat],
        getElevationWeight: (d: any) => d.num_bikes_available,
        radius: 200,
        elevationScale: 12,
        extruded: true,
        coverage: 0.85,
        opacity: 0.6,
      })
      overlayRef.current.setProps({ layers: [layer] })
    }, [data])

    return (
      <div className="relative w-full h-[500px] rounded-lg overflow-hidden border border-neutral-200">
        <div ref={ref} className="absolute inset-0" />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 text-neutral-600">
            Loading hex aggregation...
          </div>
        )}
      </div>
    )
  }
  ```

  Note: `@deck.gl/mapbox`'s `MapboxOverlay` works with MapLibre too (despite the name). If it doesn't link cleanly, the alternative is `DeckGL` directly with a `Map` as its base.

  May need to install: `npm install @deck.gl/mapbox`.

- [ ] **Step 2:** Install missing dep if needed
  ```bash
  npm install @deck.gl/mapbox@^9.0.0
  ```

- [ ] **Step 3:** Typecheck. If any types are broken, fix them by casting to `any` or by widening prop types.

- [ ] **Step 4:** Commit
  ```bash
  git add src/web/components/SpatialDensityMap.tsx package.json package-lock.json
  git commit -m "feat(web): SpatialDensityMap with deck.gl hex aggregation"
  ```

---

## Task 10: Compose /explore route

**Files:** `src/web/routes/Explore.tsx`

Replace the current placeholder Explore content. The new layout: title + date picker at top, then three stacked chart sections. Each section handles its own loading/error/empty state via the hook it uses.

- [ ] **Step 1:** Replace Explore.tsx
  ```tsx
  // src/web/routes/Explore.tsx
  import { useState } from 'react'
  import { useLiveSnapshot } from '../hooks/useLiveSnapshot'
  import SystemTotals from '../components/SystemTotals'
  import DateRangePicker from '../components/DateRangePicker'
  import SystemBikesOverTime from '../components/SystemBikesOverTime'
  import HourOfWeekHeatmap from '../components/HourOfWeekHeatmap'
  import SpatialDensityMap from '../components/SpatialDensityMap'
  import { useTotalBikesOverTime } from '../hooks/useTotalBikesOverTime'
  import { useHourOfWeek } from '../hooks/useHourOfWeek'
  import { resolveRange, type Preset } from '../lib/date-range'

  const SYSTEM_ID = 'bcycle_santabarbara'
  const R2_BASE = import.meta.env.VITE_R2_PUBLIC_URL ?? 'https://pub-83059e704dd64536a5166ab289eb42e5.r2.dev'

  export default function Explore() {
    const { data: live } = useLiveSnapshot(SYSTEM_ID)
    const [preset, setPreset] = useState<Preset>('24h')
    const range = resolveRange(preset, Math.floor(Date.now() / 1000))

    const totals = useTotalBikesOverTime({ baseUrl: R2_BASE, system: SYSTEM_ID, range })
    const hourly = useHourOfWeek({ baseUrl: R2_BASE, system: SYSTEM_ID, range })

    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-2xl font-semibold text-neutral-900">Explore</h2>
            <p className="text-sm text-neutral-600 mt-1">Historical patterns for the Santa Barbara BCycle system.</p>
          </div>
          <DateRangePicker value={preset} onChange={setPreset} />
        </div>

        {live && (
          <div className="mb-6">
            <SystemTotals stations={live.stations} variant="inline" />
          </div>
        )}

        <section className="mb-8 bg-white rounded-lg shadow-sm border border-neutral-200 p-4">
          <h3 className="text-sm font-semibold text-neutral-700 mb-2">Total bikes available over time</h3>
          {totals.loading && <div className="p-8 text-center text-neutral-500">Loading…</div>}
          {totals.error && <div className="p-8 text-center text-red-600">{totals.error.message}</div>}
          {totals.data && <SystemBikesOverTime data={totals.data} />}
        </section>

        <section className="mb-8 bg-white rounded-lg shadow-sm border border-neutral-200 p-4">
          <h3 className="text-sm font-semibold text-neutral-700 mb-2">Hour-of-week heatmap</h3>
          {hourly.loading && <div className="p-8 text-center text-neutral-500">Loading…</div>}
          {hourly.error && <div className="p-8 text-center text-red-600">{hourly.error.message}</div>}
          {hourly.data && <HourOfWeekHeatmap data={hourly.data} />}
        </section>

        <section className="mb-8 bg-white rounded-lg shadow-sm border border-neutral-200 p-4">
          <h3 className="text-sm font-semibold text-neutral-700 mb-2">Spatial density (latest snapshot)</h3>
          <SpatialDensityMap baseUrl={R2_BASE} system={SYSTEM_ID} atTs={range.toTs} />
        </section>
      </div>
    )
  }
  ```

- [ ] **Step 2:** Add `VITE_R2_PUBLIC_URL` to `.env.example` and `.env.local`
  ```
  VITE_R2_PUBLIC_URL=https://pub-83059e704dd64536a5166ab289eb42e5.r2.dev
  ```

- [ ] **Step 3:** Typecheck, test
  ```bash
  npx tsc --noEmit
  npm test
  ```

- [ ] **Step 4:** Commit
  ```bash
  git add src/web/routes/Explore.tsx .env.example .env.local
  git commit -m "feat(web): compose /explore with date picker + three chart sections"
  ```

---

## Task 11: Self-review + commit

Verify nothing on the live map regressed. Quick smoke pass:

- [ ] `npm test` — expect all tests passing (~80+)
- [ ] `npx tsc --noEmit` — clean
- [ ] `npm run build:web` — confirm a production build succeeds; note bundle size
- [ ] If everything's clean, commit (or amend last) and we're done with Plan 2

---

## Self-Review

**Spec coverage check:**

- /explore route at the right path ✓ (Task 10)
- Date range picker with presets ✓ (Task 4)
- DuckDB-WASM in a Web Worker ✓ (Task 5)
- Lazy loading via dynamic import inside the hook ✓ (Task 5)
- Total bikes over time chart ✓ (Tasks 6, 7)
- Hour-of-week heatmap ✓ (Tasks 6, 8)
- Spatial density via deck.gl hex aggregation ✓ (Task 9)
- Empty/loading/error states ✓ (Tasks 7, 8, 10)
- Reuses existing parquet/R2 ✓ (no new infra)

**Tests:** All testable units (pure functions, chart components) are covered. DuckDB-WASM bootstrap and deck.gl are explicitly skipped — they require a real browser and will be validated by manual smoke after deploy.

**No new infra needed.** The poller, read API, smoke worker, and compaction GH Action all stay as-is. This is pure frontend work.

**Bundle impact:** ~200 KB of deck.gl gzipped + ~8 MB of DuckDB-WASM loaded async after `/explore` mount. The live map bundle stays untouched.
