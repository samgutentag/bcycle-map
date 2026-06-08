# Multi-network support: seed a new bike-share city from a GBFS feed

Status: design approved 2026-06-07. Implementation plan pending.

## Goal

Let the app serve more than one GBFS bike-share network (today: BCycle Santa
Barbara; next: RedBike Cincinnati). The seam is a single feed entry: adding a
network should be one row in `systems.json` plus a deploy. Everything a network
needs to render — station locations, names, capacity, timezone, rental URL,
display name — already comes from its GBFS feed.

One deployment serves all networks. On load the app auto-selects the nearest
network by edge geo, and a picker lets the user switch. Per-network URLs
(`/<system>`) are deferred to a follow-up issue; the resolver scaffolding that
makes them trivial lands now.

## Non-goals

- Per-network deployments or subdomains. One site, one build.
- `bikemap.com/<system>` URL routing — deferred (see Deferred work). The active
  system is resolved via geo + localStorage now; the URL param is the follow-up.
- Browser geolocation prompts. Nearest-network detection uses Cloudflare edge
  geo only (no permission prompt).
- Reverse-geocoding corridor names to real neighborhoods. Real names come from
  GBFS-native regions when the feed provides them, or a committed override;
  the derived fallback uses directional labels.
- Cross-network aggregation or comparison views. Each network stays isolated.

## Current state

The backend is already multi-system; the frontend is single-tenant.

Already per-`system_id`:
- Poller loops `getSystems()` and polls each system independently.
- KV keys: `system:{systemId}:latest`, `system:{systemId}:buffer:*`.
- R2 keys: `gbfs/{systemId}/...` for activity, parquet history, typicals, routes.
- Read-API routes: `/api/systems/:systemId/current|partitions|activity|trips|snapshots`.

Hardcoded to Santa Barbara (the work):
- `const SYSTEM_ID = 'bcycle_santabarbara'` in 6 route components (LiveMap,
  Activity, Explore, FlowMap, StationDetails, RouteCheck).
- `SB_CENTER: [-119.6982, 34.4208]` map center in `LiveMap.tsx`.
- SB-specific `src/web/config/corridors.ts` (11 hand-authored neighborhoods).
- Branding strings/links in `BrandMark.tsx` and `AboutModal.tsx`.

## Architecture

Three pieces of new backend behavior (poller-side derivation + one read-API
endpoint), and a frontend refactor that replaces six hardcoded system IDs with a
single resolved context.

```
systems.json                          (seed: add a row to add a network)
   |
   v
poller (per system, each cycle)
   |-- corridors:  committed corridors/<systemId>.json?   -> use it
   |               else GBFS regions w/ station region_id? -> use named regions
   |               else                                    -> derive directional zones
   |               write gbfs/{systemId}/corridors.json (R2)
   |-- systems index: write systems-index.json (R2/KV)
   |               { systemId, name, centroid, bbox, stationCount }[]
   v
read-api
   |-- existing /api/systems/:systemId/...        (unchanged)
   |-- GET /api/systems  ->  index list, nearest flagged via request.cf geo
   v
frontend
   SystemContext (active systemId) resolved at load:
     localStorage last-pick -> nearest from /api/systems -> default (SB)
   picker in header; map auto-fits station bbox; branding from system metadata;
   corridors loaded from gbfs/{systemId}/corridors.json
```

### 1. Corridors: a three-tier mechanism, for every system

Corridors become a general mechanism, not an SB special case. The poller picks
the highest-precedence source available per system:

1. **Committed override (any system):** a committed `corridors/<systemId>.json`
   in the repo wins when present. Santa Barbara's existing curated neighborhoods
   move here as `corridors/bcycle_santabarbara.json` — the first instance of the
   override, not a separate code path.
2. **GBFS-native regions:** when the feed publishes `system_regions.json` **and**
   stations actually carry usable `region_id` values, map each station to its
   named region. This is real neighborhood names for free — e.g. RedBike
   Cincinnati ships Avondale, Clifton, Corryville, Central Business District,
   etc., with every station assigned. The validation matters: Santa Barbara
   *lists* a regions feed but its stations have no `region_id`, so SB correctly
   falls through to its override rather than to empty regions.
3. **Derived directional zones (fallback):** when neither exists, the poller
   clusters the system's stations geographically and assigns directional labels
   (North / South / East / West / Central, by angle and distance from the system
   centroid). Clustering is deterministic (seeded) so zone assignments are stable
   across polls and across users.

**Where it runs:** in the poller, alongside the existing derived artifacts
(typicals, travel-times). Whichever tier is chosen, the output is normalized to
one shape and written to `gbfs/{systemId}/corridors.json` in R2, read by the
client at page load. The client has one corridor code path regardless of source.
Rejected alternative: client-side derivation on each load — wasteful and
produces inconsistent zone assignments between users.

### 2. Systems index + nearest-network detection

- The poller writes `systems-index.json` (list of `{ systemId, name, centroid,
  bbox, stationCount }`) to R2/KV each cycle, derived from the stations it
  already fetches.
- New read-API endpoint `GET /api/systems` returns that list. It uses
  Cloudflare's edge geo (`request.cf.latitude` / `request.cf.longitude`) to flag
  the nearest system by great-circle distance to each centroid. No browser
  permission prompt; geo only exists server-side, so this lives in the worker.
- Falls back to a configured default (`bcycle_santabarbara`) if geo is absent or
  no network is within a sane radius.

### 3. Frontend de-hardcoding

- **`SystemContext` + `useSystem()` hook** replace all six
  `const SYSTEM_ID = 'bcycle_santabarbara'` constants. One resolver decides the
  active system at app load:
  `localStorage last-pick -> nearest from GET /api/systems -> default (SB)`.
  This context is the scaffold the deferred URL-routing work plugs into.
- **Network picker** component in the header near `BrandMark`. Selecting a
  network updates the context and persists to localStorage.
- **Map auto-fit:** `LiveMap` fits to the active system's station bounding box
  instead of the hardcoded `SB_CENTER` / fixed zoom.
- **Branding from metadata:** `BrandMark` title and `AboutModal`
  name/links/description read from the active system's metadata
  (GBFS `system_information`, already surfaced on `KVValue.system`, plus
  `systems.json`) instead of literal "Santa Barbara" strings.
- **Corridors loader:** `src/web/config/corridors.ts` becomes a loader that
  fetches `gbfs/{systemId}/corridors.json` for the active system. The hardcoded
  SB array moves into the committed override file.

## Data model changes

- New R2 artifact per system: `gbfs/{systemId}/corridors.json`.
- New R2/KV artifact: `systems-index.json` (cross-system list for the picker).
- New committed repo input: `corridors/<systemId>.json` (optional override;
  SB's curated data moves here).
- `systems.json` entries unchanged in shape (system_id, name, gbfs_url, version);
  optional human-facing `region`/label may be added for the picker if useful.

## Adding a network (the end state)

1. Add one row to `systems.json` with the GBFS URL. First real example:
   ```json
   { "system_id": "bcycle_cincyredbike", "name": "Red Bike - Cincinnati",
     "gbfs_url": "https://gbfs.bcycle.com/bcycle_cincyredbike/gbfs.json",
     "version": "1.1" }
   ```
2. Deploy. The poller picks it up, builds corridors (Cincinnati gets named GBFS
   regions automatically) + the index, the picker shows it, and nearby users
   auto-land on it.
3. Optional later polish: commit `corridors/<systemId>.json` to override the
   region/derived corridors with hand-tuned zones.

## Deferred work (GitHub issue)

[#99 — per-network URL routing](https://github.com/samgutentag/bcycle-map/issues/99).
`bikemap.com/<system>` URL routing: shareable/bookmarkable per-city URLs, with a
route param feeding `SystemContext` (overriding geo/localStorage when present).
The `SystemContext` resolver built here is the integration point, so the
follow-up is mostly router wiring.

## Testing

- Poller: corridor tier selection honors precedence — committed override wins;
  GBFS regions used only when stations carry usable `region_id` (SB's
  region-less feed must fall through, Cincinnati's must resolve to named
  regions); derived directional zones are deterministic for a fixed station set.
  Index entry is produced per system.
- Read-API: `GET /api/systems` returns all systems and flags nearest given a
  mocked `request.cf` geo; falls back to default when geo is absent.
- Frontend: system resolver honors precedence (localStorage > geo > default);
  picker switches context and persists; map fits bounds for a non-SB system;
  branding renders from metadata, not literals.
- End-to-end smoke: add a second system to a test `systems.json` and confirm both
  render without SB-specific assumptions leaking.
