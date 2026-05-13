# /explore View Design (Plan 2)

**Date:** 2026-05-13
**Status:** Spec written; implementation plan to follow

## Problem

Plan 1 shipped the live map at `/`. Polling has been running long enough to start accumulating parquet history in R2 (via the hourly GitHub Action). The `/explore` route is currently a placeholder — Plan 2 builds it out into the analytical companion to the live view.

The questions `/explore` should answer:
- How has total bike availability across the system changed over the last N hours/days?
- Where in the city is bike availability concentrated *over time*, not just right now?
- What are the daily/weekly patterns — when is the system fullest? When is it most strained?

The questions it explicitly *doesn't* answer (deferred to Plan 3):
- How does a *specific* station behave over time? That's per-station drill-down.

## Goals

- Three views, all driven by parquet partitions stored in R2 by the hourly compactor
- Lightweight client-side analytics: DuckDB-WASM queries parquet directly over HTTP, no backend
- Lazy-load the heavy data stack so `/` (live map) stays fast
- Reasonable empty/loading/error states; visible affordances for "data is still being collected"

## Non-goals (v1)

- Kepler.gl integration. The original Plan 1 spec mentioned Kepler; on reflection it brings ~3-5MB of bundle for features (multi-layer composition, time animation, filter UI) that exceed what this project needs at v1. Three focused charts beat one heavyweight exploratory tool. Revisit if v1 doesn't satisfy.
- Predictive forecasting or ML.
- Cross-system comparisons (still one system at v1).
- Mobile-optimized analytics. The live view works on mobile; `/explore` is OK to ship desktop-only at v1.

## Architecture

```
┌─────────────────────────────────────────┐
│  /explore route                         │
│  - DateRangePicker (24h, 7d, 30d, custom)│
│  - 3 chart sections, stacked            │
└──────────────┬──────────────────────────┘
               │
               ▼ (lazy import on /explore mount)
┌─────────────────────────────────────────┐
│  useHistoricalData(range) hook          │
│  1. Init DuckDB-WASM (once, cached)     │
│  2. Build SQL query for date range      │
│  3. Query R2 parquet via HTTP           │
│  4. Return rows                         │
└──────────────┬──────────────────────────┘
               │
               ▼ (parquet over HTTP, public R2 bucket)
┌─────────────────────────────────────────┐
│  R2 bucket: bcycle-map-archive          │
│  gbfs/<system>/station_status/          │
│    dt=2026-05-13/00.parquet, 01.parquet │
│    dt=2026-05-14/...                    │
└─────────────────────────────────────────┘
```

DuckDB-WASM lives in a Web Worker so the main thread stays responsive. It reads parquet files via standard `httpfs` extension — no proxy, no API. The R2 bucket is public (per Plan 1 decision), so the browser fetches directly.

## Components

| Component | Job |
|---|---|
| `/explore` route | Layout, date picker, lazy-loads everything else |
| `DateRangePicker` | Preset chips (24h / 7d / 30d / All) + optional custom dates |
| `useHistoricalData` hook | Initializes DuckDB once, runs queries against R2 parquet, exposes rows + loading/error states |
| `SystemBikesOverTime` chart | Hand-rolled SVG line chart: total bikes available across all stations vs time |
| `HourOfWeekHeatmap` chart | Hand-rolled SVG: 7×24 grid, color = avg bikes available per cell |
| `SpatialDensityMap` | MapLibre + deck.gl `HexagonLayer`, aggregates bike-station-snapshots into hex bins. Time slider controls which snapshot moment drives the aggregation. |

## Data flow

### DuckDB-WASM bootstrap

On `/explore` mount, lazily import `@duckdb/duckdb-wasm` (deferred chunk so it's not in the live-map bundle). Spawn the DB in a Web Worker. Install the `httpfs` extension. The worker reads parquet files at URLs like `https://pub-83059e704dd64536a5166ab289eb42e5.r2.dev/gbfs/bcycle_santabarbara/station_status/dt=2026-05-13/00.parquet`.

### Query patterns

**Total bikes over time** (for the line chart):
```sql
SELECT snapshot_ts, SUM(num_bikes_available) as total_bikes
FROM 'https://pub-<hash>.r2.dev/gbfs/<sys>/station_status/dt=*/*.parquet'
WHERE snapshot_ts BETWEEN ? AND ?
GROUP BY snapshot_ts
ORDER BY snapshot_ts;
```

**Hour-of-week heatmap**:
```sql
SELECT
  date_part('dow', to_timestamp(snapshot_ts)) as dow,
  date_part('hour', to_timestamp(snapshot_ts)) as hod,
  AVG(num_bikes_available) as avg_bikes,
  COUNT(*) as samples
FROM 'https://pub-<hash>.r2.dev/gbfs/<sys>/station_status/dt=*/*.parquet'
WHERE snapshot_ts BETWEEN ? AND ?
GROUP BY dow, hod
ORDER BY dow, hod;
```

**Spatial density** (per snapshot moment, for the hex map):
```sql
SELECT station_id, lat, lon, num_bikes_available
FROM 'https://pub-<hash>.r2.dev/gbfs/<sys>/station_status/dt=YYYY-MM-DD/HH.parquet'
WHERE snapshot_ts = (SELECT MAX(snapshot_ts) FROM ... WHERE snapshot_ts <= ?)
ORDER BY station_id;
```

DuckDB handles partition-pruning over the `dt=*` glob automatically when you filter on the timestamp.

### Partition discovery

For "all-time" queries, we need to know which `dt=*` partitions exist. R2 doesn't have public LIST without auth. Two options:

- **Option A (preferred for v1):** DuckDB's parquet glob over the date range naturally skips missing files. For "last 24h" we know what dates to glob; we don't need to list. For "all-time," we generate dates from project start (committed in a constant) to today.
- **Option B (later):** Add a tiny `/api/partitions` endpoint on the read-api Worker that lists R2 objects. Heavier, but needed if "all time" becomes inconvenient.

V1 uses Option A.

## Empty/loading/error states

- **DuckDB still initializing:** progress bar with "Setting up the in-browser database…" Takes 0.5–1.5 seconds typically.
- **R2 has no parquet yet** (project just deployed): "No history yet. The first parquet partition is written ~1 hour after the poller starts. Check back soon."
- **Query returns zero rows** (date range outside any data): "No data for this range. Try selecting a wider window."
- **Network error fetching parquet:** "Couldn't reach the data archive. Refresh to try again."

## Styling

Same Tailwind light theme as the live map. Charts use the same Positron-aligned palette: muted gray for grids, green-700 for "bikes available" data, with one accent color for highlights.

## Bundle considerations

- `@duckdb/duckdb-wasm`: ~6-8 MB of WASM, downloaded *async* in a Worker. Doesn't block first paint.
- `deck.gl/core` + `deck.gl/layers` + `@deck.gl/aggregation-layers`: ~200 KB gzipped. Lazy-imported with `/explore`.
- Hand-rolled SVG charts: ~5 KB.

Live-map bundle stays at its current ~30 KB Worker + small frontend. `/explore` adds the analytical stack only when visited.

## Testing

Unit tests for the pure pieces:
- `useHistoricalData`'s SQL builder (given a date range, what query is constructed)
- The chart components (given input rows, what SVG is rendered)
- Date range presets (given "7d", what dates are returned)

Integration tests against a small synthetic parquet fixture committed to the repo. Not against live R2 — that requires data that exists.

End-to-end / visual tests are intentionally out of scope at v1. Manual smoke after deploy.

## Open questions (worth Sam's call when reviewing)

1. **Time zone handling.** GBFS timestamps are UTC. Riders think in local. Where does conversion happen — in the DuckDB query (`AT TIME ZONE`) or in the JS display layer? Recommend display-layer for flexibility, but a per-page "view in: local / UTC" toggle would be useful.
2. **Date range default.** "Last 24h" makes sense once data exists, but might show empty for newly-deployed projects with <24h of history. Adaptive default ("the most recent N hours that have data") or fixed "24h" with empty-state messaging?
3. **Hex bin radius for the spatial map.** ~200m is a reasonable default but should be tunable. Add a slider, or pick once and ship?
4. **Mobile.** Ship desktop-only at v1 explicitly, or attempt responsive? I'd ship desktop-only and add a "best viewed on desktop" banner on small screens.

## Out of scope, deferred

- Per-station drill-down view (that's Plan 3).
- User-saved views, sharable filters.
- Comparison mode (compare two date ranges side-by-side).
- Export-to-CSV or screenshot.
- Streaming "current snapshot" indicator on the hex map (just shows snapshots in order, with time slider).
