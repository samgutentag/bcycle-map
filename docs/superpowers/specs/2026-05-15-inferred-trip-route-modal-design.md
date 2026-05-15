# Inferred-trip route modal

Status: design approved 2026-05-15. Implementation plan pending.

## Goal

Let a user click any inferred trip in the web app and see a modal popover showing
a map with the trip's endpoints marked and a "typical" Google-equivalent bike route
between them. Routes are precached on R2, mirroring the existing travel time matrix.

We are not tracking actual ridden routes. The polyline is the Google Directions API's
suggested cycling route for the station pair at build time.

## Non-goals

- Real-time route fetching (precache only).
- User-editable routes, turn-by-turn instructions, elevation.
- Capturing actual GPS traces from riders.
- Replacing the existing matrix; routes are an additive sibling artifact.

## Architecture

Two sibling R2 artifacts, both directed-pair keyed, both rebuilt by change-detection
scripts running on the same daily-check cadence in CI:

```
gbfs/{systemId}/travel-times.json   (existing)
gbfs/{systemId}/routes.json         (new)
```

Modal is a pure client-side consumer. No new Worker endpoints. No fetch at click time.

### New R2 artifact

```ts
type RouteCache = {
  computedAt: number
  stations: { id: string; lat: number; lon: number }[]
  edges: Record<string, Record<string, RouteEdge>>
}

type RouteEdge = {
  polyline: string          // Google-encoded overview_polyline
  meters: number            // distance from Directions response
  seconds: number           // duration from Directions response (bike profile)
  via_station_ids: string[] // station ids within 150m of any polyline vertex
}
```

### Data flow

```
trip row click
  -> set openTripKey in parent state
  -> TripRouteModal mounts
  -> reads trip (in memory), matrix edge (in memory), route edge (in memory)
  -> decodes polyline -> GeoJSON line
  -> MapLibre fit-bounds to endpoints + line
  -> renders origin pin, destination pin, dim via pins
```

## Build script

`scripts/compute-routes.ts`, modeled on `compute-travel-times.ts`.

| Concern | Decision |
|---|---|
| API | Google Directions, `mode=bicycling`, `units=metric` |
| Request shape | One GET per directed pair |
| Throughput | Sequential with 100ms delay, matching matrix script |
| Modes | `check`, `compute` (changed stations only, 2-pass), `compute-full` |
| Persistence | Writes `gbfs/{systemId}/routes.json` to existing public R2 bucket |
| Merge | Carry-forward edges not involving removed stations; overlay fresh updates |
| Via-station computation | After decoding polyline, haversine each station against every polyline vertex, threshold 150m to the closest vertex, sort by that closest-vertex distance for stable order |
| Failure handling | Per-pair failure logged + skipped; file still writes; missing pairs trigger modal fallback |
| CI hook | New sibling workflow `.github/workflows/routes.yml`, structured like `travel-times.yml` (daily `check` cron, manual `compute` / `compute-full` dispatch, opens an issue on detected station changes) |

### Cost (Santa Barbara BCycle, 95 stations)

- Full rebuild: 95 x 94 = 8,930 pairs at $5/1k = ~$45
- Incremental (one new station): 2 x 94 = 188 pairs = ~$0.94
- Daily `check` mode: $0 (no Google API calls)

## Modal component

`src/web/components/TripRouteModal.tsx`. Frame and lifecycle mirror `AboutModal`
(fixed inset, Escape + backdrop close, body scroll lock).

### Props

```ts
type TripRouteModalProps = {
  trip: Trip
  matrix: TravelMatrix | null
  routes: RouteCache | null
  stations: StationSnapshot[]
  systemTz: string
  onClose: () => void
}
```

### Layout

- Header: origin station name → destination station name; departure → arrival time, weekday + date.
- Body: MapLibre canvas (Positron basemap, no zoom controls, static non-toggling attribution).
- Footer stat row: Actual duration / Typical duration / Distance, units matching what `ActivityLog` already shows elsewhere in the app.

### Pins

- Origin: existing green pin SVG.
- Destination: same SVG, red variant.
- Via stations: same SVG, neutral-400 at 35% opacity, ~60% scale, non-interactive.

### Map lifecycle

MapLibre instance is created in a `useEffect` after the dialog mounts so the
container has measured size. Explicit `map.remove()` in cleanup to avoid WebGL
context leaks.

### Fallback when no cached route exists

- Dashed straight line between endpoints.
- Note under stat row: "Approximate route — bike directions not yet cached for this pair."
- Pins, stats, timestamps still render.

### Click affordance on trip rows

- Whole row is a `<button>` opening the modal.
- Existing station-name links stay intact; `event.stopPropagation()` on their click.
- Modal state lives on the parent (page) component, not per-row, so only one modal is mounted at a time.

### Surfaces where rows become clickable

- `src/web/components/ActivityLog.tsx` (used on /activity and the live map's activity panel)
- `src/web/routes/Explore.tsx` recent-trips list
- `src/web/routes/StationDetails.tsx` trips section

## New files

| Path | Purpose |
|---|---|
| `scripts/compute-routes.ts` | Build script |
| `src/shared/polyline.ts` | Google encoded polyline decoder |
| `src/shared/route-cache.ts` | `RouteCache` / `RouteEdge` types + `lookupRoute` helper |
| `src/web/hooks/useRouteCache.ts` | Loads `routes.json` from R2 |
| `src/web/components/TripRouteModal.tsx` | The modal |

## Modified files

| Path | Change |
|---|---|
| `src/web/components/ActivityLog.tsx` | Lift `openTripKey` state, wrap rows in `<button>`, stop-propagate station-name link clicks |
| `src/web/routes/Explore.tsx` | Same pattern |
| `src/web/routes/StationDetails.tsx` | Same pattern |
| `package.json` | Add `compute-routes` script |
| `.github/workflows/routes.yml` | New sibling workflow modeled on `travel-times.yml` |

## Tests

- `src/shared/polyline.test.ts` — decode known Google fixture, output matches expected coordinates to 5dp.
- `src/shared/route-cache.test.ts` — `lookupRoute` hit returns edge; miss returns `null`; asymmetric pair handled.
- `src/web/components/TripRouteModal.test.tsx` — renders cached route; renders fallback when missing; Escape closes; backdrop closes; station-name link does not close.
- MapLibre module-level mock (verify pattern used elsewhere in the suite, or add).

## Manual verification

1. Run `compute-routes.ts` on a 5-station slice locally. Inspect JSON output.
2. Run dev server, click an inferred trip on /activity, verify map + polyline + pins.
3. Stub a missing edge locally; verify dashed-line fallback + note.
4. Mobile viewport check matching `AboutModal` sizing.

## Open follow-ups (not part of this spec)

- Replace "Querying parquet from R2…" loading text with Claude-style spinner verbs
  in a JSON dict, plus a bike-themed pass on each. Source list:
  https://deepakness.com/raw/claude-spinner-verbs/. Tracked separately from this work.
- Audius Harmony design system exploration tracked at
  https://github.com/samgutentag/bcycle-map/issues/2.
