# Per-Station Metrics Design (Plan 3)

**Date:** 2026-05-13
**Status:** Spec captured, deferred until Plan 2 ships and ~2 weeks of history accumulate

## Problem

After Plan 2 ships, the `/explore` view will answer questions about the system as a whole (total bikes over time, hex-aggregated utilization, hour-of-day patterns). What's still missing is a view that answers questions about *one specific station* — useful for a regular rider who wants to know "is this station typically empty when I leave work?"

The `/station/:stationId` route already exists from Plan 1; it currently shows a popup with the live snapshot. Plan 3 extends this with a historical/predictive panel.

## Goals

- A panel on the existing `/station/:stationId` route showing this station's recent and typical patterns
- No new route — toggle between "now" and "history" within the same URL
- Reuses the parquet + DuckDB-WASM data layer from Plan 2
- Works without any backend data fetch beyond what `/explore` already does

## Non-goals (v1)

- Predictive ML models. "Typical Tuesday at 9am" is a median, not a forecast.
- Cross-station comparisons (Plan 2 handles aggregate views).
- Mobile-native gestures or interactions.

## UX shape

Two clean options, both work:

1. **Slide-in panel from the right.** Click a station marker → popup opens AND a panel slides in showing historical charts. Closing the popup (or clicking elsewhere) closes both. The URL is the same `/station/:stationId`.
2. **Tab toggle inside the popup.** Popup gains "Now / History" tabs. Smaller surface, less polished but tighter.

Recommend option 1. The right-side panel has room for a real chart at a useful size; the popup itself stays compact.

## Charts to ship in v1 of Plan 3

Three views per station. All driven by parquet data filtered to one `station_id`.

1. **Bikes available over the last 24 hours.** Simple line chart. X-axis: time. Y-axis: bikes available. ~720 points at 2-minute polling.
2. **Typical hour-of-week heatmap.** Y-axis: day-of-week (Mon-Sun). X-axis: hour-of-day (0-23). Color: average bikes available across all historical samples for that cell. Reveals daily and weekly cycles.
3. **"Right now" vs "typical now" callout.** A single sentence: "Currently 3 bikes — typically 5 bikes at this hour on a Wednesday." Median of the same hour-of-week cell, with current value compared.

## Data shape

DuckDB-WASM query against the parquet partitions in R2:

```sql
-- 24h line
SELECT snapshot_ts, num_bikes_available
FROM 'r2/gbfs/<system>/station_status/dt=*/*.parquet'
WHERE station_id = ? AND snapshot_ts > NOW() - INTERVAL 24 HOUR
ORDER BY snapshot_ts;

-- Hour-of-week heatmap
SELECT
  date_part('dow', to_timestamp(snapshot_ts)) as dow,
  date_part('hour', to_timestamp(snapshot_ts)) as hod,
  AVG(num_bikes_available) as avg_bikes
FROM 'r2/gbfs/<system>/station_status/dt=*/*.parquet'
WHERE station_id = ?
GROUP BY dow, hod;
```

DuckDB-WASM reads the parquet directly from R2 over HTTP. No backend.

## Blocked on

1. **Plan 2 must ship first.** The parquet partitions in R2, the DuckDB-WASM bootstrapping, and the date-range query helpers all come from Plan 2.
2. **~2 weeks of accumulated data.** A 24-hour line works after the first day. The hour-of-week heatmap needs at least a week to look honest, two weeks before patterns become trustworthy. Without enough samples, the heatmap is just noise and shouldn't be displayed.

## Open questions (revisit when starting implementation)

1. How do we represent "not enough data yet"? Per-cell sample count threshold? Min weeks of history? Show heatmap dimmed?
2. Time zones: GBFS gives UTC timestamps. Riders think in local time. Where does conversion happen — query time (in DuckDB) or display time (in JS)?
3. Should the panel persist when navigating between stations, or close and re-open? Persistence is nicer UX but more state.
4. Is recharts the right chart library, or do we keep going with hand-rolled SVG like the pin markers?

## Estimated scope

3-5 days of focused work after Plan 2 lands and data is sufficient. Most of the surface area is the panel UI and the DuckDB query helpers; the data layer is shared with Plan 2.
