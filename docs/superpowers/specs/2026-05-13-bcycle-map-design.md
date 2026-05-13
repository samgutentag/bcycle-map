# bcycle-map Design

**Date:** 2026-05-13
**Status:** Design approved, pre-implementation

## Problem

Bike share systems publish real-time station data via [GBFS](https://github.com/MobilityData/gbfs), a standardized open spec. Santa Barbara's BCycle system publishes a feed at `https://gbfs.bcycle.com/bcycle_santabarbara/gbfs.json` with bike and dock counts updated every 60 seconds.

GBFS gives you the *current* state of a system. It does not include trip history, ridership, or any time-series. Capturing patterns over time requires polling and storing the feed yourself.

This project builds a hosted map that shows live availability and accumulates historical snapshots for exploratory analysis.

## Goals

- A live map at `/` showing real-time station availability for one GBFS system (Santa Barbara at GBFS v1.1)
- A historical exploration view at `/explore` using Kepler.gl, backed by polled snapshots
- An architecture that supports adding more GBFS systems and versions as a config change, not a refactor
- Hosted on Cloudflare end-to-end with minimal ops overhead

## Non-goals (v1)

- Multiple systems wired up at launch (architecture is ready, but only `bcycle_santabarbara` is configured)
- Free-floating vehicle systems (Bird/Lime/Dott use `free_bike_status.json`, different schema)
- GBFS v2.x and v3.0 support (the normalize() seam exists; the additional normalizers are deferred)
- Auth-required GBFS feeds (none needed for BCycle; deferred until a system that requires it is added)
- User accounts, saved views, alerting
- Mobile-native apps (the web app should be responsive, but no native shell)

## Architecture

```text
┌─────────────────────────────┐
│   Cloudflare Pages          │
│   (React + Vite + TS)       │
│                             │
│   /         live map        │ ──► Worker API ──► KV (latest snapshot)
│   /explore  Kepler explore  │ ──► DuckDB-WASM ──► R2 parquet (direct fetch)
└─────────────────────────────┘
                                          ▲             ▲
                                          │             │
┌─────────────────────────────┐           │             │
│   Cloudflare Worker (cron)  │           │             │
│   runs every 120s           │           │             │
│                             │           │             │
│   1. Fetch gbfs.json        │           │             │
│   2. Fetch sub-feeds        │           │             │
│   3. Normalize (v1.1 → v1)  │ ──write──► KV           │
│   4. Append snapshot        │ ──write──────────────► R2 (parquet)
└─────────────────────────────┘
```

Two asymmetric data paths:

- **Hot path:** small, frequent reads. Live map → Worker API → KV.
- **Cold path:** large, occasional reads. `/explore` → DuckDB-WASM → R2 parquet (direct fetch, no API).

The split exists because KV is fast for "give me the latest" and bad at everything else, while R2 + parquet + DuckDB-WASM is fast for analytical queries and slow for "just give me the current state."

## Components

| Component | Runtime | Job |
|---|---|---|
| Frontend | Cloudflare Pages | React + Vite + TS app. Routes: `/` (live), `/explore` (historical). |
| Read API Worker | Cloudflare Workers (HTTP) | Tiny Worker that fronts KV. `GET /api/systems/:id/current` returns latest snapshot JSON. Sets CORS and cache headers. |
| Poller Worker | Cloudflare Workers (scheduled, 120s cron) | Fetches GBFS, normalizes, writes KV + R2. |
| KV namespace | Cloudflare KV | Stores latest snapshot per system **and** the intra-hour buffer of snapshots awaiting parquet compaction. Keys: `system:<system_id>:latest`, `system:<system_id>:buffer:<YYYY-MM-DD-HH>`. |
| R2 bucket | Cloudflare R2 | Stores sealed parquet partitions. **Public read** (data is already publicly redistributable). CORS allow-listed to the Pages domain. |
| DuckDB-WASM | Browser | Loaded by `/explore`. Queries R2 parquet directly via HTTP. |

### Frontend libraries

- **MapLibre GL JS** — live map renderer. Vector tiles, custom styling.
- **Kepler.gl** — `/explore` analytical view. Loads parquet via DuckDB-WASM and renders heatmaps, time animations, etc.
- **Tailwind** — utility styling, per Sam's global preferences.

## Data flow

### Poll cycle (every 120s)

1. Cron fires.
2. Fetch `gbfs.json` (root discovery).
3. Fetch `station_information.json`, `station_status.json`. Fetch `system_information.json` only if not cached today.
4. Normalize each sub-feed into the internal shape.
5. Diff `station_information` against cached version:
   - If unchanged: skip writing.
   - If changed: rewrite `station_information.parquet` in R2.
6. Read the current-hour buffer from KV (key `system:<system_id>:buffer:<YYYY-MM-DD-HH>`). Append the new snapshot. Write back. At 120s cadence the buffer holds ~30 snapshots per hour, ~1.5MB of JSON, well under KV's 25MB value limit.
7. Write the merged station-info + station-status payload to KV at `system:<system_id>:latest`.
8. If this invocation is the first of a new hour:
   - Read the previous hour's buffer from KV
   - Convert to parquet (using `parquet-wasm`, see Decisions)
   - Write to R2 at `gbfs/<sys>/station_status/dt=YYYY-MM-DD/<HH>.parquet`
   - Delete the previous hour's KV buffer key
9. Idempotency: every cycle checks "is there a previous-hour buffer still in KV with no sealed parquet in R2?" If so, compact it. This makes missed cron runs self-healing.

### Live-map read path

```
Browser → GET /api/systems/bcycle_santabarbara/current
       → Read API Worker → KV.get(...)
       → JSON back to browser
       → MapLibre re-renders 85 station markers, then polls again in 60s
```

Worker sets `Cache-Control: max-age=60` so repeated calls hit edge cache instead of KV. Polling cadence is 120s, so a 60s edge cache keeps frontend reads at most one hop stale relative to the underlying KV write.

### Explore read path

```
Browser → load /explore (Kepler + DuckDB-WASM boot)
       → user picks date range
       → DuckDB-WASM: SELECT … FROM 'https://<bucket>/.../dt=2026-05-*/*.parquet'
       → R2 streams parquet bytes
       → DuckDB executes in-browser, hands rows to Kepler
       → Kepler renders visualization
```

No API call. No backend database. The browser is the database.

## Schemas

### Internal normalized station

```ts
type Snapshot = {
  system_id: string
  snapshot_ts: number                     // unix seconds, set by Worker
  station_id: string
  // joined from station_information (slowly changing):
  name: string
  lat: number
  lon: number
  address?: string
  // from station_status (every snapshot):
  num_bikes_available: number
  num_docks_available: number
  num_bikes_by_type: { electric: number; classic: number; smart: number }
  is_installed: boolean
  is_renting: boolean
  is_returning: boolean
  last_reported: number                   // feed-provided timestamp
}
```

### KV value

An array of `Snapshot` (one per station), serialized as JSON. ~50KB for Santa Barbara's 85 stations. Overwritten every cycle.

### Parquet rows

Flattened from `Snapshot`. The `num_bikes_by_type` nested object becomes three flat columns: `bikes_electric`, `bikes_classic`, `bikes_smart`. Booleans become INT8. Parquet handles the columnar storage and compression.

### Station information parquet (slowly-changing)

One row per station: `station_id`, `name`, `lat`, `lon`, `address`, `valid_from_ts`. Rewritten only when upstream changes.

### Normalize() as the anti-corruption layer

All GBFS-version specifics live inside `normalize()`. Everything downstream (KV consumers, parquet writers, the frontend) works on the internal shape only. Adding GBFS v2.x support later means adding one more normalizer; nothing else changes.

## Error handling

| Failure | Response |
|---|---|
| Feed returns 5xx or times out | Retry once with 5s backoff, then skip this cycle. Log the failure. KV stays at last successful snapshot. |
| Feed returns malformed JSON | Log parse error, skip this cycle. |
| `station_status` missing but `station_information` OK | Skip this cycle (we need both). |
| `station_information` missing but cached | Use cached station info, proceed with status only. |
| Required field missing in `normalize()` | `normalize()` throws, caller catches, log, skip cycle. |
| Unknown new optional field in feed | Ignored. `normalize()` only reads known fields. |
| KV write fails | Log, continue to R2 work. |
| R2 write fails | Log, return non-zero so the cron run shows as failed. |
| Hourly compaction missed | Self-heal: next cycle compacts any past hour with a buffer in KV but no sealed parquet in R2. |

### Staleness signaling

Each Snapshot carries `snapshot_ts`. The live map computes age:

- **< 3min old:** no UI indicator (one polling cycle + grace)
- **3min – 10min old:** small "data is X seconds old" badge
- **> 10min old:** prominent "feed appears stale, last update at HH:MM" banner

Live map still loads from KV even if the Worker has been down for a day; the user sees the staleness banner.

### CORS

Two CORS surfaces must be configured at deploy:

1. Read API Worker → set `Access-Control-Allow-Origin: <pages-domain>` on responses.
2. R2 bucket → configure bucket CORS to allow `GET` from the Pages domain (otherwise DuckDB-WASM's parquet fetches fail).

Both go in `wrangler.toml` / R2 bucket settings.

## Testing strategy

### Unit (pure functions, no Cloudflare needed)

- `normalize(gbfsResponse, version)` — fixture-driven. Real captured GBFS responses (SB v1.1 first; v2.x/v3.0 fixtures when we add those normalizers). Most important test in the system.
- `compactToParquet(snapshots[])` — round-trip: write parquet, read it back, assert row count and column values.
- `renderStationMarker(station)` — marker color/size logic. Pure UI function.

### Integration (Worker behaviors)

Using Miniflare / `wrangler dev`:

- Stubbed GBFS feed → one cycle of scheduled Worker → assert KV and R2 writes.
- Hour-boundary compaction → assert previous hour's buffer becomes parquet, buffer is cleared.
- Failure paths: feed 500, malformed JSON, partial response.

### Smoke (real feed, scheduled)

A separate daily-cron Worker:

- Fetches the real BCycle feed
- Runs `normalize()`
- Asserts shape passes
- Posts to a Slack webhook on failure

Catches "upstream changed schema" before the prod poller silently drops cycles.

### Frontend

- Live map component → React Testing Library, render with mock snapshot, assert marker placement and colors.
- `/explore` page → manual smoke check after deploy. Kepler UI is too brittle for automation.

### Explicitly NOT tested

- MapLibre rendering internals
- Kepler UI behaviors
- DuckDB-WASM query correctness

The test boundary sits at "where my code meets someone else's library."

## Decisions (locked-in answers to former open questions)

1. **Polling cadence: 120s.** 720 invocations/day, well under the 1000/day Workers free-tier cap. We accept that snapshots are 2 minutes apart instead of matching the feed's 60s TTL exactly — historical resolution is 2-min, which is fine for the visualizations we want. The whole project stays on the Cloudflare free tier.
2. **Parquet write library: [`parquet-wasm`](https://github.com/kylebarron/parquet-wasm).** Purpose-built, runs in Workers (WASM-compatible runtime), reader + writer support, actively maintained by a known geo-data author (Kyle Barron). Fallback if it doesn't work in Workers for any reason: do compaction in a tiny Node-based scheduled GitHub Action that reads the KV buffer via API and writes parquet to R2. Decision will be revisited at the start of implementation if the in-Worker parquet write hits a runtime wall.
3. **R2 bucket: public read.** The GBFS source data is already publicly redistributable, so making the R2 mirror public adds no privacy concern and simplifies DuckDB-WASM fetches.
4. **Intra-hour buffer: KV-backed (option C).** Keep the buffer in KV at `system:<system_id>:buffer:<YYYY-MM-DD-HH>`. At hour close, read the buffer, write parquet to R2, delete the KV key. Chosen because it's both cheaper (no extra R2 writes per cycle) and simpler (no list-and-compact bookkeeping). Roughly half the operation count of option A at scale.
5. **Smoke test alerting: GitHub Issues.** A daily scheduled Worker (or GitHub Action) hits the live feed, runs `normalize()`, and if the shape check fails it `POST`s to the repo's issues endpoint with a labeled bug report. Self-throttled by checking for an existing open issue with the same label before filing a new one.

## Deferred (not v1, but considered)

- Multi-system support: config-driven, requires `normalize()` for each GBFS version present, requires a system selector UI.
- Free-floating vehicle support: separate normalize path for `free_bike_status.json`.
- User-configurable map styling: pick basemap, marker theme, color scale.
- Embeddable widget: iframe-friendly version of the live map for blog posts.
- Programmatic API: surfacing the polled data as a public read API for others to use.
