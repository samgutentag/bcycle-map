# Runbook: SB BCycle station-set change

When Santa Barbara BCycle adds, moves, or removes a station, two derived caches need a rebuild: the travel-time matrix (Google Distance Matrix API output) and the routes cache (Google Directions API output). Both cost real Google API calls.

This runbook documents the steps. The detection is automatic; the rebuild is manual.

## Detection (automatic, daily)

Two workflows run daily in `check` mode:

- `.github/workflows/travel-times.yml` — checks for station changes affecting the routing matrix. Runs at `15 14 * * *` UTC.
- `.github/workflows/routes.yml` — checks for station changes affecting the route polyline cache. Runs at `30 14 * * *` UTC (15 min after travel-times).

Both run `check` mode by default, which makes **zero** Google API calls. They only diff the current station list against the cached station set.

If a change is detected, the workflow auto-comments on the rolling tracking issue:

- Travel-time matrix: [#28](https://github.com/samgutentag/bcycle-map/issues/28) (label: `travel-times`)
- Routes cache: [#29](https://github.com/samgutentag/bcycle-map/issues/29) (label: `routes`)

The comment lists the added, moved, and removed station IDs.

## Rebuild (manual)

When you see a fresh comment on #28 or #29, decide which mode to run:

| Mode | When to use | Cost |
|------|-------------|------|
| `check` | Default daily run. No API calls. Just confirms what changed. | Free |
| `compute` | After a small change (1–3 stations). Only recomputes pairs touching the changed stations. | Small Google bill |
| `compute-full` | After a large change or if the incremental result looks wrong. Full rebuild of every pair. | Larger Google bill |

### To run

Use the GitHub UI (Actions tab → pick the workflow → "Run workflow" → choose mode), or `gh`:

```bash
# Incremental — recompute only pairs touching changed stations
gh workflow run travel-times.yml -f mode=compute
gh workflow run routes.yml -f mode=compute

# Full rebuild — every pair
gh workflow run travel-times.yml -f mode=compute-full
gh workflow run routes.yml -f mode=compute-full
```

Run travel-times first; routes second (the dependency mirrors the workflow's daily schedule offset).

### Cost guard

The Google Maps API key (`GOOGLE_MAPS_API_KEY` secret) has a budget. Before running `compute-full`, check the latest billing snapshot — a full rebuild on a 25-station system is ~625 Distance Matrix API calls and ~625 Directions API calls. Manageable as a one-off, painful if accidentally run on a schedule.

## Verification

After the workflow finishes:

1. The workflow run logs should show a non-zero update count and no API errors.
2. Open `/route/<from-id>/<to-id>` for a route involving one of the changed stations — the badge should show updated travel time + the polyline should render through the new station's coordinates.
3. The auto-issue (#28 / #29) doesn't get a new comment on the next daily check run (because the diff is now clean).

## Recovery

If a rebuild lands a bad cache (e.g. all pairs returning errors):

- The old R2 cache is still present until the rebuild commits. Wrangler R2 keeps a 7-day soft-delete window. Restore the prior `gbfs/{system_id}/travel-times.json` or `gbfs/{system_id}/routes.json` via the Cloudflare dashboard or `wrangler r2 object`.
- Re-run `check` mode to confirm the cache is sane.

## Related

- Issue #28 — travel-time matrix tracking issue
- Issue #29 — routes cache tracking issue
- `scripts/compute-travel-times.ts` — the worker doing the actual API calls
- `scripts/compute-routes.ts` — same, for route polylines
