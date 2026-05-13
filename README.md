# bcycle-map

Hosted live map of Santa Barbara BCycle stations, polling the [GBFS](https://github.com/MobilityData/gbfs) feed every 120 seconds. Cloudflare Workers do the polling, KV holds the latest snapshot, R2 holds compacted parquet history, and a small React + MapLibre frontend renders it.

The architecture is documented in [`docs/superpowers/specs/2026-05-13-bcycle-map-design.md`](docs/superpowers/specs/2026-05-13-bcycle-map-design.md). The full implementation plan is at [`docs/superpowers/plans/2026-05-13-bcycle-map-v1.md`](docs/superpowers/plans/2026-05-13-bcycle-map-v1.md).

## Tech stack

| Layer | Tools |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind, MapLibre GL JS |
| Workers | Cloudflare Workers (3 scripts: poller, read API, smoke), wrangler |
| Storage | Cloudflare KV (latest snapshot + intra-hour buffer), Cloudflare R2 (parquet partitions) |
| Compaction | GitHub Actions cron, `parquet-wasm` + `apache-arrow` in Node, `@aws-sdk/client-s3` (R2 is S3-compatible) |
| Testing | Vitest, happy-dom, @testing-library/react |

## Prerequisites

- Node 20+ and npm
- A Cloudflare account (free tier is enough)
- A GitHub account (free tier is enough)
- `gh` CLI optional but recommended for creating the repo

## Local development without deploying

Useful for the very first run after cloning, when you want to verify tests pass and the map can render.

```bash
git clone git@github.com:samgutentag/bcycle-map.git
cd bcycle-map
npm install

npm test                # 51 tests
npm run typecheck       # tsc --noEmit
npm run dev:web         # Vite at http://localhost:5173 (falls back to 5174 if taken)
```

The map will boot and render the Santa Barbara basemap, but every call to `/api/...` will 404 until a Worker is running.

To run the Workers locally too, see "Three-terminal local dev" below.

## Cloudflare setup (one-time per account)

If you're cloning this into a fresh Cloudflare account, the resources need to be provisioned and their IDs need to land in the `wrangler*.toml` files.

### 1. Authenticate

```bash
npx wrangler login        # browser OAuth
npx wrangler whoami       # capture the Account ID
```

### 2. Create the KV namespace

```bash
npx wrangler kv namespace create GBFS_KV
npx wrangler kv namespace create GBFS_KV --preview
```

Capture both IDs (production `id` and `preview_id`). Paste them into all three TOML files, replacing every `PLACEHOLDER_REPLACE_AT_DEPLOY`:

- `wrangler.toml` (poller)
- `wrangler.read-api.toml` (read API)
- `wrangler.smoke.toml` (smoke)

### 3. Create the R2 bucket

```bash
npx wrangler r2 bucket create bcycle-map-archive
```

In the Cloudflare dashboard (https://dash.cloudflare.com → R2 → bcycle-map-archive):

- **Settings → Public Development URL → Allow Access.** Capture the `https://pub-<hash>.r2.dev` URL.
- **Settings → CORS Policy → Add policy** with:
  ```json
  [
    {
      "AllowedOrigins": ["*"],
      "AllowedMethods": ["GET"],
      "AllowedHeaders": ["*"]
    }
  ]
  ```

The wildcard origin is fine for this bucket — the data is public GBFS info and R2 has no egress fees. Tighten later if your use case ever changes.

### 4. Deploy the three Workers

```bash
npx wrangler deploy                                    # poller (cron every 2 min)
npx wrangler deploy --config wrangler.read-api.toml    # HTTP read API
npx wrangler deploy --config wrangler.smoke.toml       # daily smoke test
```

Each prints its `*.workers.dev` URL. **Save the read-API URL** — the frontend needs it.

### 5. Point the frontend at the deployed read API

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Edit `.env.local`:
```
VITE_API_BASE=https://bcycle-map-read-api.<your-account>.workers.dev
```

Now `npm run dev:web` will fetch from the deployed Worker. No local Workers needed.

### 6. Verify

After the first 2-minute cron tick fires:

```bash
curl https://bcycle-map-read-api.<your-account>.workers.dev/api/systems/bcycle_santabarbara/current
```

Expected: a JSON blob with ~85 stations. If you get `not found`, the cron hasn't fired yet — wait a moment.

You can also tail Worker logs in real time:

```bash
npx wrangler tail bcycle-map-poller
```

## GitHub Actions setup (hourly parquet compaction)

The poller writes JSON snapshots to KV during each hour. A GitHub Action seals those into parquet files in R2 at the top of every hour. **This requires repository secrets to function.**

In the repo's **Settings → Secrets and variables → Actions**, add:

| Secret | Where to find it |
|---|---|
| `CF_ACCOUNT_ID` | `npx wrangler whoami` |
| `CF_KV_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens → Create Token → "Edit Cloudflare Workers KV Storage" template |
| `CF_KV_NAMESPACE_ID` | The production KV `id` from Step 2 above |
| `R2_ACCESS_KEY_ID` | Cloudflare dashboard → R2 → Manage API Tokens → Create API Token (Object Read & Write on `bcycle-map-archive`) |
| `R2_SECRET_ACCESS_KEY` | Shown once when the R2 token is created — save it |
| `R2_BUCKET` | `bcycle-map-archive` |

The workflow at `.github/workflows/compact.yml` runs hourly at 5 past the hour. Trigger it manually from the Actions tab to test.

## Three-terminal local dev (offline / no deploy required)

For working on Worker code without pushing every change. Uses Miniflare to simulate KV and R2 locally.

```bash
# Terminal 1: read API on port 8787 (matches the Vite proxy)
npx wrangler dev --config wrangler.read-api.toml --persist-to .wrangler-state

# Terminal 2: poller on port 8788 with --test-scheduled so /__scheduled is exposed
npx wrangler dev --port 8788 --persist-to .wrangler-state --test-scheduled

# Terminal 3: frontend
npm run dev:web
```

Both `wrangler dev` commands must share the same `--persist-to` directory so they see each other's KV writes.

To seed data, trigger the poller's scheduled handler manually:

```bash
curl 'http://localhost:8788/__scheduled?cron=*/2+*+*+*+*'
```

To simulate the production cron, run it in a loop:

```bash
while true; do
  curl -s 'http://localhost:8788/__scheduled?cron=*/2+*+*+*+*' > /dev/null
  echo "polled at $(date '+%H:%M:%S')"
  sleep 120
done
```

When using the local Workers, `.env.local` should NOT set `VITE_API_BASE` (or should set it to empty / unset). The Vite dev server's built-in proxy forwards `/api` to `localhost:8787`.

## Project layout

```
src/
├── shared/                  # Used by both Workers and (where typed) the Web app
│   ├── types.ts             # Snapshot, KVValue, etc
│   ├── normalize.ts         # GBFS v1.1 → internal shape (anti-corruption layer)
│   ├── parquet.ts           # Snapshot ↔ parquet bytes (Node-only)
│   ├── systems.ts           # config loader for systems.json
│   └── fixtures/            # Captured real GBFS responses for tests
├── workers/
│   ├── poller.ts            # scheduled handler: fetch GBFS → KV (latest + buffer)
│   ├── read-api.ts          # HTTP handler: GET /api/systems/:id/current
│   ├── smoke.ts             # daily handler: file GitHub Issue on normalize failure
│   └── lib/
│       ├── gbfs-client.ts   # fetch with retry
│       └── github.ts        # file-issue-with-dedupe
└── web/
    ├── main.tsx + App.tsx   # React entry + router
    ├── routes/
    │   ├── LiveMap.tsx      # MapLibre + station markers + popups
    │   └── Explore.tsx      # placeholder for Plan 2 (Kepler + DuckDB-WASM)
    ├── components/
    │   └── StalenessBadge.tsx
    ├── hooks/
    │   └── useLiveSnapshot.ts
    └── lib/
        ├── api.ts           # fetchCurrent()
        └── marker-style.ts  # color + size helpers

scripts/
└── compact.ts               # GH Action runtime: KV buffer → parquet → R2

.github/workflows/
└── compact.yml              # hourly cron that runs scripts/compact.ts

wrangler.toml                # poller config
wrangler.read-api.toml       # read API config
wrangler.smoke.toml          # smoke worker config
systems.json                 # list of GBFS systems to poll (one entry at v1)
```

## npm scripts

| Script | What it does |
|---|---|
| `npm test` | Run Vitest once |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run dev:web` | Vite dev server |
| `npm run dev:worker` | `wrangler dev` (poller, local Miniflare) |
| `npm run build:web` | Production build of the frontend → `dist/` |
| `npm run deploy:worker` | `wrangler deploy` (poller only) |

## Notes on the architecture

- **Two-minute polling** keeps everything on Cloudflare Workers Free (720 invocations/day, under the 1000/day cap).
- **Compaction lives in a GitHub Action**, not in a Worker. `parquet-wasm` + `apache-arrow` together exceed the 1 MiB Workers script size cap; pushing them out to GH Actions sidesteps that without paying for Workers Paid.
- **KV is the hot path**, R2 is the cold path. Live reads come from KV via the read API. Historical reads will come from R2 parquet directly (Plan 2, the `/explore` Kepler view).
- **The frontend is decoupled from the API host** via `VITE_API_BASE`. Dev can run against local Workers or against the deployed read API just by changing one env var.

## Roadmap

- **Plan 2** (deferred): `/explore` view backed by Kepler.gl + DuckDB-WASM. Loads R2 parquet directly in the browser and lets you slice the historical data. Will be written once enough history has accumulated to be interesting.
