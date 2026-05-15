# Popularity rollup: average trip duration + popular stations + popular routes

Status: design approved 2026-05-15. Implementation plan pending.

Covers GitHub issues:

- [#8 — average trip duration on the route-planning view](https://github.com/samgutentag/bcycle-map/issues/8)
- [#9 — popular stations + popular routes on /explore](https://github.com/samgutentag/bcycle-map/issues/9)

## Goal

Surface three new pieces of information in the web app, all derived from the same
new precomputed rollup artifact:

1. An empirical average trip duration on `/route/:from/:to` for directed pairs
   with at least 3 observed trips, replacing Google's "typical" matrix value as
   the headline number.
2. A "popular stations" tile on `/explore` ranking stations by total
   departures + arrivals over the last 30 days.
3. A "popular routes" tile on `/explore` ranking directed station pairs by
   trip count over the last 30 days.

## Non-goals

- New persistence schema. We re-derive events + trips from parquet partitions
  every rollup run; no append-only trip log.
- Multiple time-window leaderboards. 30-day rolling only.
- Per-hour or "popular this morning" framing. Daily granularity is built into
  the rolling window; freshness comes from the 4-hour cron.
- Drawing cached bike polylines on `/route` (separate follow-up, not part of
  this spec).

## Architecture

One new R2 artifact, one new CI workflow, one new build script, one new client
hook, two new tiles, one tweak on `/route`. The web app reads one JSON file at
page load; no DuckDB-WASM at runtime for these surfaces.

```
gbfs/{systemId}/popularity.json   (new)
  ^
  |
  | every 4 hours
  |
scripts/compute-popularity.ts (new)
  - reads station_status parquet partitions for last 30d from R2
  - synthesizes departure/arrival events by diffing bike counts pairwise per station
  - feeds events through src/shared/trip-inference.ts (existing, pure)
  - aggregates: per-station counts, per-pair counts + duration mean
  - writes popularity.json
```

### R2 artifact shape

```ts
type Popularity = {
  computedAt: number               // unix seconds
  windowStartTs: number            // 30 days before computedAt
  windowEndTs: number              // computedAt
  topStations: Array<{
    station_id: string
    count: number                  // departures + arrivals in window
  }>                               // top 10, sorted desc by count
  topRoutes: Array<{
    from_station_id: string
    to_station_id: string
    count: number                  // trips in window
  }>                               // top 10, sorted desc by count
  pairStats: Record<
    string,                        // from_station_id
    Record<
      string,                      // to_station_id
      { count: number; mean_sec: number }
    >
  >
}
```

Expected file size for Santa Barbara (95 stations, ~50% of pairs observed over
30d): well under 50 KB.

## Build script

`scripts/compute-popularity.ts`, modeled on `scripts/compute-routes.ts`. Reuses
the R2 S3 client pattern + parquet-wasm (already a dep, used by
`scripts/compact.ts`).

| Concern | Decision |
|---|---|
| Window | Rolling 30 days ending at script start time |
| Source | `station_status` parquet partitions on R2 (the existing snapshot history) |
| Events | Synthesized by diffing `num_bikes_available` between consecutive snapshots per station. Negative delta → `departure(delta)`, positive → `arrival(delta)`. |
| Trips | Inferred by importing the existing `inferTrips` function from `src/shared/trip-inference.ts` (line 35) and feeding it the synthesized event stream + the live travel matrix |
| Travel matrix | Fetched once at the start of the run from `gbfs/{systemId}/travel-times.json` for the inference bounds |
| Aggregations | `Map<station_id, number>` for station counts; `Map<from, Map<to, { count, durationSum }>>` for pair stats |
| Top-N selection | 10 each, sorted desc by count |
| Mean | `durationSum / count` per pair, with `count >= 1` |
| Persistence | Write `gbfs/{systemId}/popularity.json` to R2 with `CacheControl: public, max-age=300` |
| Failure: missing partition | Log warning, skip the day, continue |
| Failure: zero events parsed | Throw and refuse to overwrite the existing artifact |
| Failure: zero trips inferred | Allowed — write rollup with empty `topRoutes` and empty `pairStats`. Station counts can still be populated. |
| Cron | `0 */4 * * *` (every 4 hours UTC) |
| Manual dispatch | `workflow_dispatch` with no inputs; same script |

### Memory + runtime budget

- 95 stations × ~720 ticks/day × 30 days ≈ 2M parquet rows.
- Stream by station: per-station snapshot array peaks at ~21,600 entries × ~40 bytes ≈ 1 MB. Total active map ~ N stations × 1 MB ≈ 95 MB.
- Comfortably within GitHub Actions runner memory (7 GB).
- Wall time projection: ~30–90 seconds to read parquet, ~5 seconds to synthesize events, ~10 seconds for trip inference. Well under any reasonable workflow timeout.

### CI workflow

`.github/workflows/popularity.yml`. Same secret set as `compute-routes.yml` and
`compute-travel-times.yml`. Single job, single step. No issue-filing logic (this
isn't a station-change detector — it's a periodic refresh).

## Client integration

### New hook

`src/web/hooks/useRoutePopularity.ts` — mirrors `useRouteCache` / `useTravelMatrix`.

```ts
export type RoutePopularityState = {
  data: Popularity | null
  loading: boolean
  error: Error | null
}

export function useRoutePopularity(r2Base: string, systemId: string): RoutePopularityState
```

### `/route/:from/:to` — average duration

`src/web/routes/RouteCheck.tsx` adds `const popularity = useRoutePopularity(R2_BASE, SYSTEM_ID)`.

The existing `TravelTimeBadge` keeps its current behavior (matrix-only).
A new `AvgTripDurationBadge` component is rendered alongside it, reading `popularity.data.pairStats[from][to]`:

- If `count >= 3`: badge shows `avg X min` as its headline, with a small caption `over N trips`. Both badges are visible at once — `TravelTimeBadge` for the Google "typical", `AvgTripDurationBadge` for the empirical average.
- If `count < 3`: `AvgTripDurationBadge` renders `null`. `TravelTimeBadge` alone covers the case.

### `/explore` — two new tiles

Two new sections added to `src/web/routes/Explore.tsx`, below the existing `ActivityLog` section, using the existing `Section` wrapper. Two-column at `lg` breakpoint, stacked at `sm`.

- `src/web/components/PopularStationsTile.tsx` — renders top 10 stations from `popularity.topStations`. Each row: rank, station name (looked up via `live.stations`), count. Whole row is a button → navigates to `/station/:id/details`. Empty state: short note + spinner verb while loading.
- `src/web/components/PopularRoutesTile.tsx` — renders top 10 routes from `popularity.topRoutes`. Each row: rank, "from → to" station names, count. Whole row → `/route/:from/:to`. Same loading + empty patterns.

Both tiles share styling vocabulary with existing Harmony tiles (`Paper` card, `Stack`, `Text` variants, `useTheme` for tokens).

## New files

| Path | Purpose |
|---|---|
| `scripts/compute-popularity.ts` | Build script |
| `.github/workflows/popularity.yml` | New CI workflow |
| `src/shared/popularity.ts` | `Popularity` / `PairStat` types + `lookupPairStat(...)` helper |
| `src/web/hooks/useRoutePopularity.ts` | R2 fetch hook |
| `src/web/components/PopularStationsTile.tsx` | /explore tile |
| `src/web/components/PopularRoutesTile.tsx` | /explore tile |
| `src/web/components/AvgTripDurationBadge.tsx` | /route badge for empirical avg |

## Modified files

| Path | Change |
|---|---|
| `src/web/routes/Explore.tsx` | Two new `<Section>` blocks wired to `useRoutePopularity` |
| `src/web/routes/RouteCheck.tsx` | Add `useRoutePopularity` call; render `<AvgTripDurationBadge>` alongside `<TravelTimeBadge>` when data present |
| `package.json` | Add `compute-popularity` npm script |

## Tests

- `src/shared/popularity.test.ts` — type round-trip + `lookupPairStat` hit/miss.
- `src/web/components/PopularStationsTile.test.tsx` — renders top 10, handles empty array, click navigation.
- `src/web/components/PopularRoutesTile.test.tsx` — same.
- `src/web/components/AvgTripDurationBadge.test.tsx` — renders avg when count >= 3, renders nothing otherwise.
- No unit tests for `compute-popularity.ts` itself (matches the pattern for `compute-routes.ts` / `compute-travel-times.ts` — they're verified by the next workflow run + their idempotent design).

## Manual verification

1. Locally run the script against the real R2 with a short window override (e.g., 7d) to validate the data shape and top-10 selection.
2. After deploy, dispatch `popularity` workflow once with `workflow_dispatch`.
3. Curl `gbfs/bcycle_santabarbara/popularity.json` and confirm shape, computedAt, topStations + topRoutes + pairStats populated.
4. Reload `/explore` — two new tiles visible with real data.
5. Reload `/route/:any/:other` for a pair with `count >= 3` — avg badge shows.
6. Reload `/route` for a pair with `count < 3` (rare directed pair) — falls back to matrix typical only.

## KV / R2 cost notes

The rollup uses **zero KV operations**. Reads parquet from R2 (free egress, R2 ops well under free tier), writes one JSON to R2 (Class A op, hundreds per month for the new workflow). Doesn't touch the poller's KV budget.

The user separately observed a 50% KV daily-put alert from Cloudflare; that's the poller's baseline (~576/day from latest + buffer writes against the 1000/day free-tier cap), unrelated to this work but worth tracking as its own optimization issue.

## Open follow-ups (not part of this spec)

- Drawing cached bike polylines on `/route/:from/:to` (mentioned verbally — should be filed as its own issue before being picked up).
- Poller KV optimization to bring the daily-put baseline well under 50% of the cap.
- Multi-window leaderboards (7d / 30d / all-time tabs) — straightforward to add once the daily aggregation pipeline exists.
