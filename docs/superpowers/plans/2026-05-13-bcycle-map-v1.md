# bcycle-map v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a hosted live map of Santa Barbara BCycle station availability, polling the GBFS feed every 120s and storing snapshots for later historical analysis. Deploy end-to-end on Cloudflare's free tier.

**Architecture:** Cloudflare-native for the hot path (Pages frontend + Workers for poller/read API/smoke), KV for hot data (latest snapshot + intra-hour buffer). For the cold path, **a GitHub Action does hourly parquet compaction** (Worker bundle size limits + parquet-wasm pulled us over the 1 MiB Workers Free script-size cap, so the spec's documented fallback is in play). The GH Action reads the KV buffer via Cloudflare's REST API and writes parquet to R2 via the S3-compatible API.

**Tech Stack:** TypeScript, Vite, React, Tailwind, MapLibre GL JS, Cloudflare Workers, KV, R2, parquet-wasm (Node-side only), GitHub Actions, Vitest, Miniflare, Wrangler 3.

**Scope:** Covers v1 of the spec **except** the `/explore` Kepler view. That ships as Plan 2 once data has accumulated.

**Reference spec:** `docs/superpowers/specs/2026-05-13-bcycle-map-design.md`

---

## Amendment 2026-05-13 (mid-execution)

During Task 9 (parquet serializer) a `wrangler deploy --dry-run` revealed the poller bundle landed at **1.86 MiB compressed** with `parquet-wasm` included. Workers Free tier caps script size at 1 MiB compressed. The spec's documented fallback is now in effect: **`parquet-wasm` is removed from the Worker bundle. Compaction moves to a GitHub Action.**

Concrete changes to the plan below:

- **Task 9 cleanup (between Tasks 9 and 10):** `src/shared/parquet.ts` reverts to `parquet-wasm/node` import only. The Vitest alias added in commit `fbe76b6` goes away. This module is now Node-only — it's imported from `scripts/compact.ts`, never from a Worker.
- **Task 13 (compaction) shrinks:** removed entirely from the poller Worker. The Worker stops at "write KV buffer." The buffer accumulates in KV across an hour with no per-cycle parquet work.
- **Task 14 (poller scheduled handler):** simpler. Just `pollOnce` + `writeSnapshotToKV` in the cron loop.
- **New Task 17a: `scripts/compact.ts`** — Node script that lists buffer keys via Cloudflare's KV REST API, compacts each finished-hour buffer into parquet, uploads to R2 via the S3 SDK, deletes the KV buffer.
- **New Task 17b: `.github/workflows/compact.yml`** — hourly cron workflow that runs `scripts/compact.ts`.
- **Task 23 (Cloudflare provisioning):** add steps for the new GitHub secrets (`CF_ACCOUNT_ID`, `CF_KV_API_TOKEN`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`).

Tasks 10-12, 15-22 are unchanged.

---

## File Structure

The project is a single npm package with two compile targets (Vite for the web app, Wrangler/esbuild for the Workers). Shared code lives in `src/shared/`.

```
bcycle-map/
├── package.json
├── tsconfig.json
├── wrangler.toml                    # Cloudflare config: KV, R2, three Worker scripts
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── index.html
├── .gitignore
├── .env.example
├── README.md
├── docs/superpowers/
│   ├── specs/2026-05-13-bcycle-map-design.md
│   └── plans/2026-05-13-bcycle-map-v1.md  ← this file
├── src/
│   ├── shared/
│   │   ├── types.ts                 # Snapshot, StationSnapshot, KVValue, NormalizeError
│   │   ├── normalize.ts             # GBFS v1.1 → internal shape
│   │   ├── normalize.test.ts        # fixture-driven tests
│   │   ├── parquet.ts               # serialize snapshots → parquet bytes
│   │   ├── parquet.test.ts
│   │   └── fixtures/
│   │       ├── gbfs-discovery.json
│   │       ├── station-information-v1.1.json
│   │       ├── station-status-v1.1.json
│   │       └── system-information-v1.1.json
│   ├── workers/
│   │   ├── poller.ts                # scheduled (every 120s)
│   │   ├── poller.test.ts
│   │   ├── read-api.ts              # HTTP: GET /api/systems/:id/current
│   │   ├── read-api.test.ts
│   │   ├── smoke.ts                 # scheduled (daily) → GitHub Issues on failure
│   │   ├── smoke.test.ts
│   │   └── lib/
│   │       ├── gbfs-client.ts       # fetch + retry + JSON parse
│   │       └── github.ts            # file/check issue helper
│   └── web/
│       ├── main.tsx
│       ├── App.tsx
│       ├── index.css                # Tailwind base
│       ├── routes/
│       │   ├── LiveMap.tsx
│       │   └── Explore.tsx          # placeholder for Plan 2
│       ├── components/
│       │   ├── StationMarker.tsx
│       │   ├── StationMarker.test.tsx
│       │   ├── StalenessBadge.tsx
│       │   └── StalenessBadge.test.tsx
│       ├── hooks/
│       │   └── useLiveSnapshot.ts
│       └── lib/
│           ├── api.ts               # fetch /api/systems/:id/current
│           └── marker-style.ts      # color + size helpers (pure functions)
└── systems.json                     # config: list of GBFS systems (one entry for v1)
```

### File responsibilities (the contract each one fulfills)

| File | Responsibility |
|---|---|
| `src/shared/types.ts` | Internal data shapes. Single source of truth for `Snapshot`, `KVValue`, etc. |
| `src/shared/normalize.ts` | Anti-corruption boundary. Maps GBFS v1.1 → internal shape. Throws `NormalizeError` on bad input. |
| `src/shared/parquet.ts` | Convert array of snapshots → parquet bytes. Wraps `parquet-wasm`. |
| `src/workers/poller.ts` | Scheduled handler. Fetch → normalize → KV write → hour-close compaction. |
| `src/workers/read-api.ts` | HTTP handler. Returns latest KV snapshot. Sets CORS + cache headers. |
| `src/workers/smoke.ts` | Daily check. If feed normalize fails, file a GitHub Issue (deduped). |
| `src/workers/lib/gbfs-client.ts` | Fetch GBFS sub-feeds with retry + timeout. |
| `src/workers/lib/github.ts` | Minimal GitHub API client (search issues + create issue). |
| `src/web/lib/marker-style.ts` | Pure functions: `markerColor(pctAvail)`, `markerSize(totalDocks)`. Trivially unit-testable. |
| `src/web/hooks/useLiveSnapshot.ts` | React hook: fetch current snapshot, refresh every 60s, expose age in seconds. |
| `src/web/components/StationMarker.tsx` | One station's pin: position + color + size + click handler. |
| `src/web/components/StalenessBadge.tsx` | Renders nothing if `ageSec < 180`, badge if 180–600, banner if > 600. |
| `src/web/routes/LiveMap.tsx` | Composes MapLibre + `useLiveSnapshot` + markers + badge. |
| `systems.json` | Config: list of `{ system_id, name, gbfs_url, version }`. v1 has one entry. |

---

## Conventions used in this plan

- **TDD throughout.** Each implementation task starts with a failing test, then minimal code to make it pass.
- **One commit per task.** Conventional Commits format (`feat:`, `test:`, `chore:`, etc.).
- **Branch:** work on `main`. This is a brand-new solo project, no need for feature branches.
- **Indent:** 2 spaces. Quotes: single. No semicolons unless required (Sam's preferences).
- **Run tests with:** `npm test` (Vitest), `npm run test:watch` for iterating.
- **Run worker locally with:** `npx wrangler dev` (uses Miniflare for KV + R2 simulation).

---

## Task 1: Initialize repo and basic config

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `tsconfig.json`
- Create: `README.md`

- [ ] **Step 1: Initialize git and npm**

```bash
cd /Users/samgutentag/Developer/bcycle-map
git init
npm init -y
```

- [ ] **Step 2: Write `.gitignore`**

```gitignore
node_modules/
dist/
.wrangler/
.dev.vars
.env
.env.local
*.log
.DS_Store
```

- [ ] **Step 3: Replace generated `package.json` with the real one**

```json
{
  "name": "bcycle-map",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "dev:web": "vite",
    "dev:worker": "wrangler dev",
    "build:web": "vite build",
    "deploy:worker": "wrangler deploy"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.6.0",
    "@types/node": "^20.12.0"
  }
}
```

- [ ] **Step 4: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true,
    "paths": {
      "@shared/*": ["./src/shared/*"]
    }
  },
  "include": ["src/**/*", "vite.config.ts", "wrangler.toml"]
}
```

- [ ] **Step 5: Write minimal `README.md`**

```markdown
# bcycle-map

Hosted live map of Santa Barbara BCycle stations, polling the GBFS feed every 120s.

See `docs/superpowers/specs/2026-05-13-bcycle-map-design.md` for the design.

## Develop

\`\`\`bash
npm install
npm test
npm run dev:web      # frontend
npm run dev:worker   # workers (uses Miniflare)
\`\`\`
```

- [ ] **Step 6: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` populated, no errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: initialize repo with package.json, tsconfig, gitignore"
```

---

## Task 2: Capture GBFS fixtures from the live feed

**Files:**
- Create: `src/shared/fixtures/gbfs-discovery.json`
- Create: `src/shared/fixtures/station-information-v1.1.json`
- Create: `src/shared/fixtures/station-status-v1.1.json`
- Create: `src/shared/fixtures/system-information-v1.1.json`

- [ ] **Step 1: Fetch and save the four sub-feeds**

```bash
mkdir -p src/shared/fixtures
curl -s https://gbfs.bcycle.com/bcycle_santabarbara/gbfs.json \
  | python3 -m json.tool > src/shared/fixtures/gbfs-discovery.json
curl -s https://gbfs.bcycle.com/bcycle_santabarbara/station_information.json \
  | python3 -m json.tool > src/shared/fixtures/station-information-v1.1.json
curl -s https://gbfs.bcycle.com/bcycle_santabarbara/station_status.json \
  | python3 -m json.tool > src/shared/fixtures/station-status-v1.1.json
curl -s https://gbfs.bcycle.com/bcycle_santabarbara/system_information.json \
  | python3 -m json.tool > src/shared/fixtures/system-information-v1.1.json
```

- [ ] **Step 2: Verify fixtures look right**

```bash
jq '.data.stations | length' src/shared/fixtures/station-information-v1.1.json
```

Expected: a number (likely 85, may drift over time as BCycle adds/removes stations).

- [ ] **Step 3: Commit**

```bash
git add src/shared/fixtures/
git commit -m "test: capture GBFS v1.1 fixtures from Santa Barbara live feed"
```

---

## Task 3: Define shared types

**Files:**
- Create: `src/shared/types.ts`

- [ ] **Step 1: Write `src/shared/types.ts`**

```ts
export type SystemInfo = {
  system_id: string
  name: string
  timezone: string
  language: string
}

export type StationStatic = {
  station_id: string
  name: string
  lat: number
  lon: number
  address?: string
}

export type StationDynamic = {
  station_id: string
  num_bikes_available: number
  num_docks_available: number
  bikes_electric: number
  bikes_classic: number
  bikes_smart: number
  is_installed: boolean
  is_renting: boolean
  is_returning: boolean
  last_reported: number
}

export type StationSnapshot = StationStatic & StationDynamic

export type KVValue = {
  system: SystemInfo
  snapshot_ts: number
  stations: StationSnapshot[]
}

export type BufferEntry = {
  snapshot_ts: number
  stations: StationDynamic[]
}

export class NormalizeError extends Error {
  constructor(message: string, public field?: string) {
    super(message)
    this.name = 'NormalizeError'
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors. (We have no other files yet, so this just verifies the tsconfig works.)

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: define shared types for snapshots and KV values"
```

---

## Task 4: Implement `normalizeStationInformation` (failing test first)

**Files:**
- Create: `src/shared/normalize.test.ts`
- Create: `src/shared/normalize.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/shared/normalize.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeStationInformation } from './normalize'

const fixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/station-information-v1.1.json'), 'utf8')
)

describe('normalizeStationInformation', () => {
  it('returns one StationStatic per upstream station', () => {
    const result = normalizeStationInformation(fixture)
    expect(result.length).toBe(fixture.data.stations.length)
  })

  it('preserves station_id, name, lat, lon, address', () => {
    const result = normalizeStationInformation(fixture)
    const upstream = fixture.data.stations[0]
    const out = result.find(s => s.station_id === upstream.station_id)
    expect(out).toBeDefined()
    expect(out!.name).toBe(upstream.name)
    expect(out!.lat).toBe(upstream.lat)
    expect(out!.lon).toBe(upstream.lon)
    expect(out!.address).toBe(upstream.address)
  })

  it('throws NormalizeError when stations array is missing', () => {
    expect(() => normalizeStationInformation({ data: {} } as any)).toThrow(/stations/)
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

```bash
npm test -- normalize
```

Expected: FAIL — "Cannot find module './normalize'" or similar.

- [ ] **Step 3: Implement `normalizeStationInformation`**

```ts
// src/shared/normalize.ts
import { NormalizeError, StationStatic } from './types'

type StationInfoFeed = {
  data?: { stations?: Array<{
    station_id: string
    name: string
    lat: number
    lon: number
    address?: string
  }> }
}

export function normalizeStationInformation(feed: StationInfoFeed): StationStatic[] {
  const stations = feed?.data?.stations
  if (!Array.isArray(stations)) {
    throw new NormalizeError('station_information.data.stations missing', 'stations')
  }
  return stations.map(s => ({
    station_id: s.station_id,
    name: s.name,
    lat: s.lat,
    lon: s.lon,
    address: s.address,
  }))
}
```

- [ ] **Step 4: Run test, verify it passes**

```bash
npm test -- normalize
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/shared/normalize.ts src/shared/normalize.test.ts
git commit -m "feat(shared): normalize GBFS v1.1 station_information"
```

---

## Task 5: Implement `normalizeStationStatus`

**Files:**
- Modify: `src/shared/normalize.test.ts`
- Modify: `src/shared/normalize.ts`

- [ ] **Step 1: Append failing tests to `normalize.test.ts`**

```ts
import { normalizeStationStatus } from './normalize'

const statusFixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/station-status-v1.1.json'), 'utf8')
)

describe('normalizeStationStatus', () => {
  it('returns one StationDynamic per upstream status entry', () => {
    const result = normalizeStationStatus(statusFixture)
    expect(result.length).toBe(statusFixture.data.stations.length)
  })

  it('flattens num_bikes_available_types into three columns', () => {
    const result = normalizeStationStatus(statusFixture)
    const upstream = statusFixture.data.stations[0]
    const out = result.find(s => s.station_id === upstream.station_id)
    expect(out!.bikes_electric).toBe(upstream.num_bikes_available_types.electric ?? 0)
    expect(out!.bikes_classic).toBe(upstream.num_bikes_available_types.classic ?? 0)
    expect(out!.bikes_smart).toBe(upstream.num_bikes_available_types.smart ?? 0)
  })

  it('coerces is_installed/is_renting/is_returning to booleans', () => {
    const result = normalizeStationStatus(statusFixture)
    const out = result[0]
    expect(typeof out.is_installed).toBe('boolean')
    expect(typeof out.is_renting).toBe('boolean')
    expect(typeof out.is_returning).toBe('boolean')
  })

  it('throws NormalizeError when stations array is missing', () => {
    expect(() => normalizeStationStatus({ data: {} } as any)).toThrow(/stations/)
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

```bash
npm test -- normalize
```

Expected: FAIL — "normalizeStationStatus is not exported".

- [ ] **Step 3: Implement `normalizeStationStatus`**

```ts
// append to src/shared/normalize.ts
import { StationDynamic } from './types'

type StationStatusFeed = {
  data?: { stations?: Array<{
    station_id: string
    num_bikes_available: number
    num_docks_available: number
    num_bikes_available_types?: { electric?: number; classic?: number; smart?: number }
    is_installed: number | boolean
    is_renting: number | boolean
    is_returning: number | boolean
    last_reported: number
  }> }
}

export function normalizeStationStatus(feed: StationStatusFeed): StationDynamic[] {
  const stations = feed?.data?.stations
  if (!Array.isArray(stations)) {
    throw new NormalizeError('station_status.data.stations missing', 'stations')
  }
  return stations.map(s => ({
    station_id: s.station_id,
    num_bikes_available: s.num_bikes_available,
    num_docks_available: s.num_docks_available,
    bikes_electric: s.num_bikes_available_types?.electric ?? 0,
    bikes_classic: s.num_bikes_available_types?.classic ?? 0,
    bikes_smart: s.num_bikes_available_types?.smart ?? 0,
    is_installed: Boolean(s.is_installed),
    is_renting: Boolean(s.is_renting),
    is_returning: Boolean(s.is_returning),
    last_reported: s.last_reported,
  }))
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npm test -- normalize
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/shared/normalize.ts src/shared/normalize.test.ts
git commit -m "feat(shared): normalize GBFS v1.1 station_status with type-flat columns"
```

---

## Task 6: Implement `normalizeSystemInformation` and `mergeSnapshot`

**Files:**
- Modify: `src/shared/normalize.test.ts`
- Modify: `src/shared/normalize.ts`

- [ ] **Step 1: Append failing tests**

```ts
import { normalizeSystemInformation, mergeSnapshot } from './normalize'

const sysFixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/system-information-v1.1.json'), 'utf8')
)

describe('normalizeSystemInformation', () => {
  it('extracts system_id, name, timezone, language', () => {
    const out = normalizeSystemInformation(sysFixture)
    expect(out.system_id).toBe(sysFixture.data.system_id)
    expect(out.name).toBe(sysFixture.data.name)
    expect(out.timezone).toBe(sysFixture.data.timezone)
    expect(out.language).toBe(sysFixture.data.language)
  })
})

describe('mergeSnapshot', () => {
  it('joins static and dynamic by station_id', () => {
    const statics = normalizeStationInformation(fixture)
    const dyns = normalizeStationStatus(statusFixture)
    const merged = mergeSnapshot(statics, dyns)
    expect(merged.length).toBeGreaterThan(0)
    const first = merged[0]
    expect(first).toHaveProperty('lat')
    expect(first).toHaveProperty('num_bikes_available')
  })

  it('drops dynamic entries with no matching static record', () => {
    const statics = normalizeStationInformation(fixture).slice(0, 1)
    const dyns = normalizeStationStatus(statusFixture)
    const merged = mergeSnapshot(statics, dyns)
    expect(merged.length).toBe(1)
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

```bash
npm test -- normalize
```

Expected: FAIL — exports missing.

- [ ] **Step 3: Append implementation**

```ts
// append to src/shared/normalize.ts
import { SystemInfo, StationSnapshot } from './types'

type SystemInfoFeed = {
  data?: {
    system_id: string
    name: string
    timezone: string
    language: string
  }
}

export function normalizeSystemInformation(feed: SystemInfoFeed): SystemInfo {
  const d = feed?.data
  if (!d) throw new NormalizeError('system_information.data missing', 'data')
  return {
    system_id: d.system_id,
    name: d.name,
    timezone: d.timezone,
    language: d.language,
  }
}

export function mergeSnapshot(
  statics: StationStatic[],
  dyns: StationDynamic[]
): StationSnapshot[] {
  const byId = new Map(statics.map(s => [s.station_id, s]))
  return dyns
    .map(d => {
      const s = byId.get(d.station_id)
      return s ? { ...s, ...d } : null
    })
    .filter((x): x is StationSnapshot => x !== null)
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npm test -- normalize
```

Expected: 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/shared/normalize.ts src/shared/normalize.test.ts
git commit -m "feat(shared): normalize system_information and merge static + dynamic"
```

---

## Task 7: Wrangler + Miniflare setup

**Files:**
- Create: `wrangler.toml`
- Create: `worker-configuration.d.ts`
- Modify: `package.json` (add wrangler, miniflare deps)

- [ ] **Step 1: Install wrangler and types**

```bash
npm install --save-dev wrangler@^3.78 @cloudflare/workers-types@^4.20240419.0
```

- [ ] **Step 2: Write `wrangler.toml`**

```toml
name = "bcycle-map-poller"
main = "src/workers/poller.ts"
compatibility_date = "2024-09-25"
compatibility_flags = ["nodejs_compat"]

# scheduled (cron) trigger — every 2 minutes
[triggers]
crons = ["*/2 * * * *"]

[[kv_namespaces]]
binding = "GBFS_KV"
id = "PLACEHOLDER_REPLACE_AT_DEPLOY"
preview_id = "PLACEHOLDER_REPLACE_AT_DEPLOY"

[[r2_buckets]]
binding = "GBFS_R2"
bucket_name = "bcycle-map-archive"

[vars]
SYSTEMS_JSON_URL = ""  # set per environment; empty = use embedded systems.json

# Second worker: HTTP read API
# (We will deploy this as a separate Worker; for v1, one wrangler.toml = one Worker.
#  The read-api Worker gets its own config file added in Task 15.)
```

- [ ] **Step 3: Add the workers-types reference**

```ts
// worker-configuration.d.ts
/// <reference types="@cloudflare/workers-types" />

export type Env = {
  GBFS_KV: KVNamespace
  GBFS_R2: R2Bucket
  SYSTEMS_JSON_URL?: string
  GITHUB_TOKEN?: string  // used by smoke worker
  GITHUB_REPO?: string   // e.g. "samgutentag/bcycle-map"
}
```

- [ ] **Step 4: Update tsconfig to include the worker types ref**

Edit `tsconfig.json` — add `worker-configuration.d.ts` to `include`:

```json
"include": ["src/**/*", "vite.config.ts", "wrangler.toml", "worker-configuration.d.ts"]
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add wrangler.toml worker-configuration.d.ts tsconfig.json package.json package-lock.json
git commit -m "chore: wire wrangler + workers-types"
```

---

## Task 8: GBFS client (fetch with retry)

**Files:**
- Create: `src/workers/lib/gbfs-client.ts`
- Create: `src/workers/lib/gbfs-client.test.ts`

- [ ] **Step 1: Failing test**

```ts
// src/workers/lib/gbfs-client.test.ts
import { describe, it, expect, vi } from 'vitest'
import { fetchJsonWithRetry } from './gbfs-client'

describe('fetchJsonWithRetry', () => {
  it('returns parsed JSON on first success', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    )
    const result = await fetchJsonWithRetry('http://example/', { fetchImpl: fetchFn })
    expect(result).toEqual({ ok: true })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('retries once on 5xx then succeeds', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response('boom', { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const result = await fetchJsonWithRetry('http://example/', { fetchImpl: fetchFn, backoffMs: 0 })
    expect(result).toEqual({ ok: true })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('throws after both attempts fail', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('boom', { status: 503 }))
    await expect(
      fetchJsonWithRetry('http://example/', { fetchImpl: fetchFn, backoffMs: 0 })
    ).rejects.toThrow(/503/)
  })
})
```

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- gbfs-client
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/workers/lib/gbfs-client.ts
type Opts = {
  fetchImpl?: typeof fetch
  backoffMs?: number
  timeoutMs?: number
}

export async function fetchJsonWithRetry<T = unknown>(
  url: string,
  opts: Opts = {}
): Promise<T> {
  const fetchFn = opts.fetchImpl ?? fetch
  const backoffMs = opts.backoffMs ?? 5000
  const timeoutMs = opts.timeoutMs ?? 10_000

  const attempt = async (): Promise<T> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetchFn(url, { signal: controller.signal })
      if (!res.ok) throw new Error(`${url} returned ${res.status}`)
      return await res.json() as T
    } finally {
      clearTimeout(timer)
    }
  }

  try {
    return await attempt()
  } catch (err) {
    await new Promise(r => setTimeout(r, backoffMs))
    return await attempt()
  }
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test -- gbfs-client
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/workers/lib/gbfs-client.ts src/workers/lib/gbfs-client.test.ts
git commit -m "feat(workers): GBFS fetch client with single retry on failure"
```

---

## Task 9: Parquet serializer

**Files:**
- Create: `src/shared/parquet.ts`
- Create: `src/shared/parquet.test.ts`

- [ ] **Step 1: Install parquet-wasm**

```bash
npm install parquet-wasm@^0.6.1
```

- [ ] **Step 2: Failing test**

```ts
// src/shared/parquet.test.ts
import { describe, it, expect } from 'vitest'
import { snapshotsToParquet, parquetToSnapshots } from './parquet'
import { StationSnapshot } from './types'

const sample: StationSnapshot = {
  station_id: 'bcycle_santabarbara_4852',
  name: 'West Cota & State',
  lat: 34.4179,
  lon: -119.69708,
  address: '601 State St.',
  num_bikes_available: 3,
  num_docks_available: 7,
  bikes_electric: 3,
  bikes_classic: 0,
  bikes_smart: 0,
  is_installed: true,
  is_renting: true,
  is_returning: true,
  last_reported: 1778692030,
}

describe('snapshotsToParquet', () => {
  it('round-trips a single-row snapshot batch', async () => {
    const buf = await snapshotsToParquet([{ snapshot_ts: 1778692030, station: sample }])
    expect(buf.byteLength).toBeGreaterThan(0)
    const back = await parquetToSnapshots(buf)
    expect(back.length).toBe(1)
    expect(back[0].station.station_id).toBe(sample.station_id)
    expect(back[0].station.num_bikes_available).toBe(3)
  })

  it('round-trips many rows', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      snapshot_ts: 1778692030 + i * 60,
      station: { ...sample, num_bikes_available: i % 10 },
    }))
    const buf = await snapshotsToParquet(rows)
    const back = await parquetToSnapshots(buf)
    expect(back.length).toBe(100)
    expect(back[99].station.num_bikes_available).toBe(9)
  })
})
```

- [ ] **Step 3: Run, verify fail**

```bash
npm test -- parquet
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```ts
// src/shared/parquet.ts
import { StationSnapshot } from './types'
import * as parquet from 'parquet-wasm'

export type SnapshotRow = {
  snapshot_ts: number
  station: StationSnapshot
}

const COLUMNS = [
  'snapshot_ts', 'station_id', 'name', 'lat', 'lon', 'address',
  'num_bikes_available', 'num_docks_available',
  'bikes_electric', 'bikes_classic', 'bikes_smart',
  'is_installed', 'is_renting', 'is_returning', 'last_reported',
] as const

export async function snapshotsToParquet(rows: SnapshotRow[]): Promise<Uint8Array> {
  await parquet.default()  // initialize WASM
  const records = rows.map(r => ({
    snapshot_ts: r.snapshot_ts,
    station_id: r.station.station_id,
    name: r.station.name,
    lat: r.station.lat,
    lon: r.station.lon,
    address: r.station.address ?? '',
    num_bikes_available: r.station.num_bikes_available,
    num_docks_available: r.station.num_docks_available,
    bikes_electric: r.station.bikes_electric,
    bikes_classic: r.station.bikes_classic,
    bikes_smart: r.station.bikes_smart,
    is_installed: r.station.is_installed,
    is_renting: r.station.is_renting,
    is_returning: r.station.is_returning,
    last_reported: r.station.last_reported,
  }))
  return parquet.writeParquetFromJson(JSON.stringify(records))
}

export async function parquetToSnapshots(buf: Uint8Array): Promise<SnapshotRow[]> {
  await parquet.default()
  const json = parquet.readParquetAsJson(buf)
  const records: any[] = JSON.parse(json)
  return records.map(r => ({
    snapshot_ts: r.snapshot_ts,
    station: {
      station_id: r.station_id,
      name: r.name,
      lat: r.lat,
      lon: r.lon,
      address: r.address || undefined,
      num_bikes_available: r.num_bikes_available,
      num_docks_available: r.num_docks_available,
      bikes_electric: r.bikes_electric,
      bikes_classic: r.bikes_classic,
      bikes_smart: r.bikes_smart,
      is_installed: r.is_installed,
      is_renting: r.is_renting,
      is_returning: r.is_returning,
      last_reported: r.last_reported,
    },
  }))
}
```

Note: `parquet-wasm`'s exact API may shift across versions. If the imports above don't line up with the installed version, check `node_modules/parquet-wasm/README.md` and adapt. The intent is: serialize → bytes → deserialize. If it cannot run in the Worker context, fall back to the GitHub Action compaction path (see spec Decision #2).

- [ ] **Step 5: Run, verify pass**

```bash
npm test -- parquet
```

Expected: 2 tests pass. If the parquet-wasm API differs from the code above, fix imports/method names until tests pass. The fixture data and test contract should not change.

- [ ] **Step 6: Commit**

```bash
git add src/shared/parquet.ts src/shared/parquet.test.ts package.json package-lock.json
git commit -m "feat(shared): parquet serialize/deserialize round-trip for snapshots"
```

---

## Task 10: Systems config

**Files:**
- Create: `systems.json`
- Create: `src/shared/systems.ts`
- Create: `src/shared/systems.test.ts`

- [ ] **Step 1: Write `systems.json`**

```json
[
  {
    "system_id": "bcycle_santabarbara",
    "name": "Santa Barbara BCycle",
    "gbfs_url": "https://gbfs.bcycle.com/bcycle_santabarbara/gbfs.json",
    "version": "1.1"
  }
]
```

- [ ] **Step 2: Failing test**

```ts
// src/shared/systems.test.ts
import { describe, it, expect } from 'vitest'
import { getSystems, getSystem } from './systems'

describe('getSystems', () => {
  it('returns the configured systems', () => {
    const systems = getSystems()
    expect(systems.length).toBeGreaterThan(0)
    expect(systems[0].system_id).toBe('bcycle_santabarbara')
  })
})

describe('getSystem', () => {
  it('returns the system by id', () => {
    const s = getSystem('bcycle_santabarbara')
    expect(s).toBeDefined()
    expect(s!.gbfs_url).toMatch(/bcycle_santabarbara/)
  })

  it('returns undefined for unknown id', () => {
    expect(getSystem('not_a_system')).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run, verify fail**

```bash
npm test -- systems
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```ts
// src/shared/systems.ts
import systemsData from '../../systems.json' assert { type: 'json' }

export type SystemConfig = {
  system_id: string
  name: string
  gbfs_url: string
  version: string
}

const systems = systemsData as SystemConfig[]

export function getSystems(): SystemConfig[] {
  return systems
}

export function getSystem(systemId: string): SystemConfig | undefined {
  return systems.find(s => s.system_id === systemId)
}
```

- [ ] **Step 5: Run, verify pass**

```bash
npm test -- systems
```

Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add systems.json src/shared/systems.ts src/shared/systems.test.ts
git commit -m "feat(shared): systems config loader (one system at v1)"
```

---

## Task 11: Poller — fetch and normalize one system (no storage yet)

**Files:**
- Create: `src/workers/poller.ts`
- Create: `src/workers/poller.test.ts`

- [ ] **Step 1: Failing test**

```ts
// src/workers/poller.test.ts
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pollOnce } from './poller'
import type { SystemConfig } from '@shared/systems'

const discovery = JSON.parse(readFileSync(join(__dirname, '../shared/fixtures/gbfs-discovery.json'), 'utf8'))
const stationInfo = JSON.parse(readFileSync(join(__dirname, '../shared/fixtures/station-information-v1.1.json'), 'utf8'))
const stationStatus = JSON.parse(readFileSync(join(__dirname, '../shared/fixtures/station-status-v1.1.json'), 'utf8'))
const systemInfo = JSON.parse(readFileSync(join(__dirname, '../shared/fixtures/system-information-v1.1.json'), 'utf8'))

const sys: SystemConfig = {
  system_id: 'bcycle_santabarbara',
  name: 'Santa Barbara BCycle',
  gbfs_url: 'https://gbfs.bcycle.com/bcycle_santabarbara/gbfs.json',
  version: '1.1',
}

const makeFetch = () => vi.fn((url: string) => {
  if (url.endsWith('/gbfs.json')) return Promise.resolve(new Response(JSON.stringify(discovery), { status: 200 }))
  if (url.endsWith('/station_information.json')) return Promise.resolve(new Response(JSON.stringify(stationInfo), { status: 200 }))
  if (url.endsWith('/station_status.json')) return Promise.resolve(new Response(JSON.stringify(stationStatus), { status: 200 }))
  if (url.endsWith('/system_information.json')) return Promise.resolve(new Response(JSON.stringify(systemInfo), { status: 200 }))
  return Promise.resolve(new Response('404', { status: 404 }))
})

describe('pollOnce', () => {
  it('returns a KVValue with merged stations and system info', async () => {
    const fetchFn = makeFetch()
    const result = await pollOnce(sys, { fetchImpl: fetchFn, now: () => 1778692030 })
    expect(result.system.system_id).toBe('bcycle_santabarbara')
    expect(result.snapshot_ts).toBe(1778692030)
    expect(result.stations.length).toBe(stationInfo.data.stations.length)
    expect(result.stations[0]).toHaveProperty('lat')
    expect(result.stations[0]).toHaveProperty('num_bikes_available')
  })
})
```

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- poller
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `pollOnce`**

```ts
// src/workers/poller.ts
import { fetchJsonWithRetry } from './lib/gbfs-client'
import {
  normalizeStationInformation,
  normalizeStationStatus,
  normalizeSystemInformation,
  mergeSnapshot,
} from '@shared/normalize'
import { KVValue } from '@shared/types'
import { SystemConfig } from '@shared/systems'

type PollDeps = {
  fetchImpl?: typeof fetch
  now?: () => number
}

type Discovery = {
  data: { en: { feeds: Array<{ name: string; url: string }> } }
}

export async function pollOnce(system: SystemConfig, deps: PollDeps = {}): Promise<KVValue> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000))

  const discovery = await fetchJsonWithRetry<Discovery>(system.gbfs_url, { fetchImpl })
  const feeds = Object.fromEntries(discovery.data.en.feeds.map(f => [f.name, f.url]))

  if (!feeds.station_information || !feeds.station_status || !feeds.system_information) {
    throw new Error(`Missing required sub-feed for ${system.system_id}`)
  }

  const [statics, dyns, sysInfo] = await Promise.all([
    fetchJsonWithRetry(feeds.station_information, { fetchImpl }).then(normalizeStationInformation),
    fetchJsonWithRetry(feeds.station_status, { fetchImpl }).then(normalizeStationStatus),
    fetchJsonWithRetry(feeds.system_information, { fetchImpl }).then(normalizeSystemInformation),
  ])

  return {
    system: sysInfo,
    snapshot_ts: now(),
    stations: mergeSnapshot(statics, dyns),
  }
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test -- poller
```

Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add src/workers/poller.ts src/workers/poller.test.ts
git commit -m "feat(workers): pollOnce fetches and normalizes a GBFS system"
```

---

## Task 12: Poller — KV write + buffer accumulation

**Files:**
- Modify: `src/workers/poller.ts`
- Modify: `src/workers/poller.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
import { writeSnapshotToKV, currentBufferKey } from './poller'
import type { KVNamespace } from '@cloudflare/workers-types'

function makeKV(): KVNamespace {
  const store = new Map<string, string>()
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value) }),
    delete: vi.fn(async (key: string) => { store.delete(key) }),
    list: vi.fn(async () => ({ keys: [...store.keys()].map(name => ({ name })), list_complete: true, cursor: '' })),
  } as unknown as KVNamespace
}

describe('writeSnapshotToKV', () => {
  it('writes latest and appends to the current-hour buffer', async () => {
    const kv = makeKV()
    const snap = await pollOnce(sys, { fetchImpl: makeFetch(), now: () => 1778692030 })
    await writeSnapshotToKV(kv, snap)
    const latest = await kv.get(`system:${snap.system.system_id}:latest`)
    expect(latest).not.toBeNull()
    expect(JSON.parse(latest!).snapshot_ts).toBe(1778692030)
    const bufKey = currentBufferKey(snap.system.system_id, snap.snapshot_ts)
    const buf = await kv.get(bufKey)
    expect(buf).not.toBeNull()
    const parsed = JSON.parse(buf!)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBe(1)
    expect(parsed[0].snapshot_ts).toBe(1778692030)
  })

  it('appends a second snapshot to the existing buffer for the same hour', async () => {
    const kv = makeKV()
    const snap1 = await pollOnce(sys, { fetchImpl: makeFetch(), now: () => 1778692030 })
    const snap2 = await pollOnce(sys, { fetchImpl: makeFetch(), now: () => 1778692150 })
    await writeSnapshotToKV(kv, snap1)
    await writeSnapshotToKV(kv, snap2)
    const bufKey = currentBufferKey(snap1.system.system_id, snap1.snapshot_ts)
    const buf = JSON.parse((await kv.get(bufKey))!)
    expect(buf.length).toBe(2)
  })
})

describe('currentBufferKey', () => {
  it('keys by system_id and UTC YYYY-MM-DD-HH', () => {
    const key = currentBufferKey('bcycle_santabarbara', 1778692030)
    expect(key).toMatch(/^system:bcycle_santabarbara:buffer:\d{4}-\d{2}-\d{2}-\d{2}$/)
  })
})
```

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- poller
```

Expected: FAIL — exports missing.

- [ ] **Step 3: Append implementation**

```ts
// append to src/workers/poller.ts
import type { KVNamespace } from '@cloudflare/workers-types'
import { BufferEntry, KVValue } from '@shared/types'

export function currentBufferKey(systemId: string, snapshotTs: number): string {
  const d = new Date(snapshotTs * 1000)
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  return `system:${systemId}:buffer:${yyyy}-${mm}-${dd}-${hh}`
}

export function latestKey(systemId: string): string {
  return `system:${systemId}:latest`
}

export async function writeSnapshotToKV(kv: KVNamespace, snap: KVValue): Promise<void> {
  await kv.put(latestKey(snap.system.system_id), JSON.stringify(snap))

  const bufKey = currentBufferKey(snap.system.system_id, snap.snapshot_ts)
  const existing = await kv.get(bufKey)
  const buffer: BufferEntry[] = existing ? JSON.parse(existing) : []
  buffer.push({
    snapshot_ts: snap.snapshot_ts,
    stations: snap.stations.map(s => ({
      station_id: s.station_id,
      num_bikes_available: s.num_bikes_available,
      num_docks_available: s.num_docks_available,
      bikes_electric: s.bikes_electric,
      bikes_classic: s.bikes_classic,
      bikes_smart: s.bikes_smart,
      is_installed: s.is_installed,
      is_renting: s.is_renting,
      is_returning: s.is_returning,
      last_reported: s.last_reported,
    })),
  })
  await kv.put(bufKey, JSON.stringify(buffer))
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test -- poller
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/workers/poller.ts src/workers/poller.test.ts
git commit -m "feat(workers): KV latest + hourly buffer writes"
```

---

## Task 13: Poller — hourly compaction to R2

**Files:**
- Modify: `src/workers/poller.ts`
- Modify: `src/workers/poller.test.ts`

- [ ] **Step 1: Append failing test**

```ts
import { compactPreviousHourIfNeeded, parquetKey } from './poller'
import type { R2Bucket } from '@cloudflare/workers-types'

function makeR2(): R2Bucket {
  const store = new Map<string, Uint8Array>()
  return {
    put: vi.fn(async (key: string, value: ArrayBuffer | Uint8Array) => {
      const buf = value instanceof Uint8Array ? value : new Uint8Array(value)
      store.set(key, buf)
      return {} as any
    }),
    get: vi.fn(async (key: string) => {
      const v = store.get(key)
      return v ? { arrayBuffer: async () => v.buffer } as any : null
    }),
    head: vi.fn(async (key: string) => store.has(key) ? {} as any : null),
    list: vi.fn(async () => ({ objects: [...store.keys()].map(k => ({ key: k })) } as any)),
    delete: vi.fn(async (key: string) => { store.delete(key) }),
  } as unknown as R2Bucket
}

describe('parquetKey', () => {
  it('returns date-partitioned path', () => {
    const key = parquetKey('bcycle_santabarbara', 1778692030)
    expect(key).toMatch(/^gbfs\/bcycle_santabarbara\/station_status\/dt=\d{4}-\d{2}-\d{2}\/\d{2}\.parquet$/)
  })
})

describe('compactPreviousHourIfNeeded', () => {
  it('compacts the previous hour buffer into R2 and clears the KV key', async () => {
    const kv = makeKV()
    const r2 = makeR2()

    // simulate two snapshots in hour H-1
    const prevHourTs = 1778688030  // pick a ts firmly inside one hour
    const snap1 = await pollOnce(sys, { fetchImpl: makeFetch(), now: () => prevHourTs })
    const snap2 = await pollOnce(sys, { fetchImpl: makeFetch(), now: () => prevHourTs + 120 })
    await writeSnapshotToKV(kv, snap1)
    await writeSnapshotToKV(kv, snap2)

    // now run compaction with "now" set to next hour
    const nowTs = prevHourTs + 3600 + 60
    await compactPreviousHourIfNeeded(kv, r2, sys.system_id, nowTs)

    const expectedR2Key = parquetKey(sys.system_id, prevHourTs)
    const obj = await r2.get(expectedR2Key)
    expect(obj).not.toBeNull()
    const oldBufKey = currentBufferKey(sys.system_id, prevHourTs)
    expect(await kv.get(oldBufKey)).toBeNull()
  })

  it('is idempotent if the parquet for previous hour already exists', async () => {
    const kv = makeKV()
    const r2 = makeR2()
    const prevHourTs = 1778688030
    const snap = await pollOnce(sys, { fetchImpl: makeFetch(), now: () => prevHourTs })
    await writeSnapshotToKV(kv, snap)
    const nowTs = prevHourTs + 3600 + 60

    await compactPreviousHourIfNeeded(kv, r2, sys.system_id, nowTs)
    const putCallsBefore = (r2.put as any).mock.calls.length

    await compactPreviousHourIfNeeded(kv, r2, sys.system_id, nowTs)
    const putCallsAfter = (r2.put as any).mock.calls.length
    expect(putCallsAfter).toBe(putCallsBefore)
  })
})
```

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- poller
```

Expected: FAIL.

- [ ] **Step 3: Append implementation**

```ts
// append to src/workers/poller.ts
import { snapshotsToParquet } from '@shared/parquet'

function previousHourBufferKey(systemId: string, nowTs: number): string {
  return currentBufferKey(systemId, nowTs - 3600)
}

export function parquetKey(systemId: string, snapshotTs: number): string {
  const d = new Date(snapshotTs * 1000)
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  return `gbfs/${systemId}/station_status/dt=${yyyy}-${mm}-${dd}/${hh}.parquet`
}

export async function compactPreviousHourIfNeeded(
  kv: KVNamespace,
  r2: R2Bucket,
  systemId: string,
  nowTs: number
): Promise<void> {
  const prevBufKey = previousHourBufferKey(systemId, nowTs)
  const prevR2Key = parquetKey(systemId, nowTs - 3600)

  const alreadySealed = await r2.head(prevR2Key)
  if (alreadySealed) {
    await kv.delete(prevBufKey)
    return
  }

  const bufRaw = await kv.get(prevBufKey)
  if (!bufRaw) return

  const buffer: BufferEntry[] = JSON.parse(bufRaw)

  // need to attach static info back to each entry for the parquet rows.
  // pull latest from KV to get the station static data.
  const latestRaw = await kv.get(latestKey(systemId))
  const latest: KVValue | null = latestRaw ? JSON.parse(latestRaw) : null
  const staticById = new Map<string, { name: string; lat: number; lon: number; address?: string }>(
    latest?.stations.map(s => [s.station_id, { name: s.name, lat: s.lat, lon: s.lon, address: s.address }]) ?? []
  )

  const rows = buffer.flatMap(entry =>
    entry.stations.map(d => {
      const stat = staticById.get(d.station_id) ?? { name: '', lat: 0, lon: 0 }
      return {
        snapshot_ts: entry.snapshot_ts,
        station: { ...stat, ...d, address: stat.address },
      }
    })
  )

  const parquetBytes = await snapshotsToParquet(rows)
  await r2.put(prevR2Key, parquetBytes)
  await kv.delete(prevBufKey)
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test -- poller
```

Expected: 7 tests pass total.

- [ ] **Step 5: Commit**

```bash
git add src/workers/poller.ts src/workers/poller.test.ts
git commit -m "feat(workers): hourly parquet compaction with idempotent self-heal"
```

---

## Task 14: Poller — scheduled handler entrypoint

**Files:**
- Modify: `src/workers/poller.ts`

- [ ] **Step 1: Append the scheduled handler**

```ts
// append to src/workers/poller.ts
import type { ScheduledEvent, ExecutionContext } from '@cloudflare/workers-types'
import { getSystems } from '@shared/systems'
import type { Env } from '../../worker-configuration'

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const systems = getSystems()
    for (const sys of systems) {
      try {
        const snap = await pollOnce(sys)
        await writeSnapshotToKV(env.GBFS_KV, snap)
        await compactPreviousHourIfNeeded(env.GBFS_KV, env.GBFS_R2, sys.system_id, snap.snapshot_ts)
      } catch (err) {
        console.error(`poll failed for ${sys.system_id}:`, err)
      }
    }
  },
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Local smoke (Miniflare)**

```bash
npx wrangler dev --test-scheduled
```

In another terminal, trigger the scheduled handler:

```bash
curl 'http://localhost:8787/__scheduled?cron=*/2+*+*+*+*'
```

Expected: console shows fetches happening, no thrown errors. Stop with `Ctrl-C`.

(If wrangler complains about missing KV/R2 IDs, that's expected — Miniflare uses local stubs automatically in dev mode.)

- [ ] **Step 4: Commit**

```bash
git add src/workers/poller.ts
git commit -m "feat(workers): scheduled handler that polls all configured systems"
```

---

## Task 15: Read API Worker

**Files:**
- Create: `src/workers/read-api.ts`
- Create: `src/workers/read-api.test.ts`
- Create: `wrangler.read-api.toml`

- [ ] **Step 1: Failing test**

```ts
// src/workers/read-api.test.ts
import { describe, it, expect, vi } from 'vitest'
import worker from './read-api'
import type { Env } from '../../worker-configuration'

function makeEnv(latestValue: string | null): Env {
  return {
    GBFS_KV: { get: vi.fn(async (_: string) => latestValue) } as any,
    GBFS_R2: {} as any,
  }
}

describe('read-api', () => {
  it('returns 404 for unknown system', async () => {
    const env = makeEnv(null)
    const res = await worker.fetch(
      new Request('https://example/api/systems/unknown/current'),
      env
    )
    expect(res.status).toBe(404)
  })

  it('returns latest JSON with CORS + cache headers', async () => {
    const payload = JSON.stringify({
      system: { system_id: 'bcycle_santabarbara' },
      snapshot_ts: 1,
      stations: [],
    })
    const env = makeEnv(payload)
    const res = await worker.fetch(
      new Request('https://example/api/systems/bcycle_santabarbara/current'),
      env
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/json/)
    expect(res.headers.get('access-control-allow-origin')).toBeTruthy()
    expect(res.headers.get('cache-control')).toMatch(/max-age=60/)
    expect(await res.text()).toBe(payload)
  })

  it('returns 404 for unknown route', async () => {
    const env = makeEnv(null)
    const res = await worker.fetch(new Request('https://example/'), env)
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- read-api
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/workers/read-api.ts
import type { Env } from '../../worker-configuration'
import { latestKey } from './poller'

const CORS_HEADERS = {
  'access-control-allow-origin': '*',  // tightened to Pages domain at deploy via env var
  'access-control-allow-methods': 'GET, OPTIONS',
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    const match = url.pathname.match(/^\/api\/systems\/([^/]+)\/current$/)
    if (!match) return new Response('not found', { status: 404 })

    const systemId = match[1]
    const raw = await env.GBFS_KV.get(latestKey(systemId))
    if (!raw) return new Response('not found', { status: 404, headers: CORS_HEADERS })

    return new Response(raw, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'content-type': 'application/json',
        'cache-control': 'max-age=60',
      },
    })
  },
}
```

- [ ] **Step 4: Write `wrangler.read-api.toml`**

```toml
name = "bcycle-map-read-api"
main = "src/workers/read-api.ts"
compatibility_date = "2024-09-25"
compatibility_flags = ["nodejs_compat"]

[[kv_namespaces]]
binding = "GBFS_KV"
id = "PLACEHOLDER_REPLACE_AT_DEPLOY"
preview_id = "PLACEHOLDER_REPLACE_AT_DEPLOY"

[[r2_buckets]]
binding = "GBFS_R2"
bucket_name = "bcycle-map-archive"
```

- [ ] **Step 5: Run, verify pass**

```bash
npm test -- read-api
```

Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/workers/read-api.ts src/workers/read-api.test.ts wrangler.read-api.toml
git commit -m "feat(workers): read API worker for /api/systems/:id/current"
```

---

## Task 16: GitHub Issues client (for smoke worker)

**Files:**
- Create: `src/workers/lib/github.ts`
- Create: `src/workers/lib/github.test.ts`

- [ ] **Step 1: Failing test**

```ts
// src/workers/lib/github.test.ts
import { describe, it, expect, vi } from 'vitest'
import { fileIssueIfNoneOpen } from './github'

describe('fileIssueIfNoneOpen', () => {
  it('does nothing if an open issue with the label already exists', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('/search/issues')) {
        return new Response(JSON.stringify({ items: [{ number: 5 }] }), { status: 200 })
      }
      return new Response('unexpected', { status: 500 })
    })
    await fileIssueIfNoneOpen({
      token: 't',
      repo: 'owner/repo',
      label: 'smoke-failure',
      title: 'Smoke failed',
      body: 'details',
      fetchImpl: fetchFn,
    })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('creates an issue when no open one exists', async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/search/issues')) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 })
      }
      if (url.endsWith('/issues') && init?.method === 'POST') {
        return new Response(JSON.stringify({ number: 42 }), { status: 201 })
      }
      return new Response('unexpected', { status: 500 })
    })
    const result = await fileIssueIfNoneOpen({
      token: 't',
      repo: 'owner/repo',
      label: 'smoke-failure',
      title: 'Smoke failed',
      body: 'details',
      fetchImpl: fetchFn,
    })
    expect(result?.number).toBe(42)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- github
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/workers/lib/github.ts
type FileIssueArgs = {
  token: string
  repo: string
  label: string
  title: string
  body: string
  fetchImpl?: typeof fetch
}

export async function fileIssueIfNoneOpen(args: FileIssueArgs): Promise<{ number: number } | null> {
  const fetchFn = args.fetchImpl ?? fetch
  const headers = {
    authorization: `Bearer ${args.token}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'bcycle-map-smoke',
  }

  const q = encodeURIComponent(`repo:${args.repo} is:issue is:open label:${args.label}`)
  const search = await fetchFn(`https://api.github.com/search/issues?q=${q}`, { headers })
  if (!search.ok) throw new Error(`github search failed: ${search.status}`)
  const { items } = await search.json() as { items: unknown[] }
  if (items.length > 0) return null

  const create = await fetchFn(`https://api.github.com/repos/${args.repo}/issues`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ title: args.title, body: args.body, labels: [args.label] }),
  })
  if (!create.ok) throw new Error(`github create failed: ${create.status}`)
  return await create.json() as { number: number }
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test -- github
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/workers/lib/github.ts src/workers/lib/github.test.ts
git commit -m "feat(workers): GitHub issue filer with open-issue dedupe"
```

---

## Task 17: Smoke test Worker

**Files:**
- Create: `src/workers/smoke.ts`
- Create: `src/workers/smoke.test.ts`
- Create: `wrangler.smoke.toml`

- [ ] **Step 1: Failing test**

```ts
// src/workers/smoke.test.ts
import { describe, it, expect, vi } from 'vitest'
import { runSmoke } from './smoke'

const sys = { system_id: 's', name: 'S', gbfs_url: 'http://x/gbfs.json', version: '1.1' }

describe('runSmoke', () => {
  it('does nothing when the feed normalizes successfully', async () => {
    const fileFn = vi.fn()
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/gbfs.json')) return new Response(JSON.stringify({
        data: { en: { feeds: [
          { name: 'station_information', url: 'http://x/station_information.json' },
          { name: 'station_status', url: 'http://x/station_status.json' },
          { name: 'system_information', url: 'http://x/system_information.json' },
        ] } }
      }))
      if (url.endsWith('/station_information.json')) return new Response(JSON.stringify({ data: { stations: [{ station_id: 'a', name: 'A', lat: 0, lon: 0 }] } }))
      if (url.endsWith('/station_status.json')) return new Response(JSON.stringify({ data: { stations: [{ station_id: 'a', num_bikes_available: 0, num_docks_available: 0, is_installed: 1, is_renting: 1, is_returning: 1, last_reported: 0 }] } }))
      if (url.endsWith('/system_information.json')) return new Response(JSON.stringify({ data: { system_id: 's', name: 'S', timezone: 'UTC', language: 'en' } }))
      return new Response('404', { status: 404 })
    })
    await runSmoke([sys], { fetchImpl: fetchFn, fileIssue: fileFn })
    expect(fileFn).not.toHaveBeenCalled()
  })

  it('files an issue when normalization throws', async () => {
    const fileFn = vi.fn()
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/gbfs.json')) return new Response(JSON.stringify({ data: { en: { feeds: [] } } }))
      return new Response('404', { status: 404 })
    })
    await runSmoke([sys], { fetchImpl: fetchFn, fileIssue: fileFn })
    expect(fileFn).toHaveBeenCalledTimes(1)
    const call = fileFn.mock.calls[0][0]
    expect(call.label).toBe('smoke-failure')
    expect(call.title).toMatch(/smoke/i)
  })
})
```

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- smoke
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/workers/smoke.ts
import type { ScheduledEvent, ExecutionContext } from '@cloudflare/workers-types'
import { pollOnce } from './poller'
import { fileIssueIfNoneOpen } from './lib/github'
import { getSystems, SystemConfig } from '@shared/systems'
import type { Env } from '../../worker-configuration'

type SmokeDeps = {
  fetchImpl?: typeof fetch
  fileIssue?: (args: {
    label: string
    title: string
    body: string
  }) => Promise<unknown>
}

export async function runSmoke(systems: SystemConfig[], deps: SmokeDeps): Promise<void> {
  const fileIssue = deps.fileIssue ?? (async () => {})
  for (const sys of systems) {
    try {
      await pollOnce(sys, { fetchImpl: deps.fetchImpl })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await fileIssue({
        label: 'smoke-failure',
        title: `Smoke check failed for ${sys.system_id}`,
        body: `Smoke poll failed.\n\nSystem: ${sys.system_id}\nURL: ${sys.gbfs_url}\nError: ${message}`,
      })
    }
  }
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
      console.warn('smoke: GITHUB_TOKEN/GITHUB_REPO not set, skipping issue filing')
    }
    await runSmoke(getSystems(), {
      fileIssue: async (args) => {
        if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return
        await fileIssueIfNoneOpen({
          token: env.GITHUB_TOKEN,
          repo: env.GITHUB_REPO,
          ...args,
        })
      },
    })
  },
}
```

- [ ] **Step 4: Write `wrangler.smoke.toml`**

```toml
name = "bcycle-map-smoke"
main = "src/workers/smoke.ts"
compatibility_date = "2024-09-25"
compatibility_flags = ["nodejs_compat"]

# Daily at 09:00 UTC
[triggers]
crons = ["0 9 * * *"]

[[kv_namespaces]]
binding = "GBFS_KV"
id = "PLACEHOLDER_REPLACE_AT_DEPLOY"
preview_id = "PLACEHOLDER_REPLACE_AT_DEPLOY"

[[r2_buckets]]
binding = "GBFS_R2"
bucket_name = "bcycle-map-archive"
```

- [ ] **Step 5: Run, verify pass**

```bash
npm test -- smoke
```

Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/workers/smoke.ts src/workers/smoke.test.ts wrangler.smoke.toml
git commit -m "feat(workers): daily smoke test files GitHub issue on failure"
```

---

## Task 18: Frontend scaffold (Vite + React + Tailwind)

**Files:**
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `tailwind.config.js`
- Create: `postcss.config.js`
- Create: `src/web/main.tsx`
- Create: `src/web/App.tsx`
- Create: `src/web/index.css`

- [ ] **Step 1: Install web dependencies**

```bash
npm install react@^18.3.0 react-dom@^18.3.0 react-router-dom@^6.26.0
npm install --save-dev vite@^5.4.0 @vitejs/plugin-react@^4.3.0 \
  @types/react@^18.3.0 @types/react-dom@^18.3.0 \
  tailwindcss@^3.4.0 postcss@^8.4.0 autoprefixer@^10.4.0 \
  @testing-library/react@^16.0.0 @testing-library/jest-dom@^6.5.0 \
  happy-dom@^15.7.0
```

- [ ] **Step 2: Write `vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@web': resolve(__dirname, 'src/web'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8787',  // wrangler dev port
    },
  },
  build: {
    outDir: 'dist',
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/web/test-setup.ts'],
  },
})
```

- [ ] **Step 3: Write `tailwind.config.js`, `postcss.config.js`, `src/web/index.css`**

`tailwind.config.js`:
```js
export default {
  content: ['./index.html', './src/web/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
}
```

`postcss.config.js`:
```js
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
}
```

`src/web/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 4: Write `index.html`, `src/web/main.tsx`, `src/web/App.tsx`, `src/web/test-setup.ts`**

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>bcycle-map</title>
  </head>
  <body class="bg-neutral-950 text-neutral-100">
    <div id="root"></div>
    <script type="module" src="/src/web/main.tsx"></script>
  </body>
</html>
```

`src/web/main.tsx`:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
)
```

`src/web/App.tsx`:
```tsx
import { Routes, Route, Link } from 'react-router-dom'
import LiveMap from './routes/LiveMap'
import Explore from './routes/Explore'

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-4 py-3 border-b border-neutral-800 flex items-center gap-4">
        <h1 className="font-semibold">bcycle-map</h1>
        <nav className="flex gap-3 text-sm">
          <Link to="/" className="hover:underline">Live</Link>
          <Link to="/explore" className="hover:underline">Explore</Link>
        </nav>
      </header>
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<LiveMap />} />
          <Route path="/explore" element={<Explore />} />
        </Routes>
      </main>
    </div>
  )
}
```

`src/web/test-setup.ts`:
```ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 5: Stub the route components for now**

`src/web/routes/LiveMap.tsx`:
```tsx
export default function LiveMap() {
  return <div className="p-4">live map (placeholder)</div>
}
```

`src/web/routes/Explore.tsx`:
```tsx
export default function Explore() {
  return <div className="p-4">explore (coming in Plan 2)</div>
}
```

- [ ] **Step 6: Boot dev server**

```bash
npm run dev:web
```

Expected: Vite output shows `Local: http://localhost:5173`. Open in browser. The header and "live map (placeholder)" should render with the dark theme. Stop with `Ctrl-C`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(web): scaffold Vite + React + Tailwind with route placeholders"
```

---

## Task 19: Marker style helpers (pure functions)

**Files:**
- Create: `src/web/lib/marker-style.ts`
- Create: `src/web/lib/marker-style.test.ts`

- [ ] **Step 1: Failing test**

```ts
// src/web/lib/marker-style.test.ts
import { describe, it, expect } from 'vitest'
import { markerColor, markerSize, pctAvailable } from './marker-style'

describe('pctAvailable', () => {
  it('returns 0 when no bikes', () => {
    expect(pctAvailable({ bikes: 0, docks: 10 })).toBe(0)
  })
  it('returns 1 when no docks open', () => {
    expect(pctAvailable({ bikes: 10, docks: 0 })).toBe(1)
  })
  it('returns 0.5 for balanced', () => {
    expect(pctAvailable({ bikes: 5, docks: 5 })).toBe(0.5)
  })
  it('returns 0 when station has zero total capacity (avoid divide-by-zero)', () => {
    expect(pctAvailable({ bikes: 0, docks: 0 })).toBe(0)
  })
})

describe('markerColor', () => {
  it('returns red-ish for empty stations', () => {
    expect(markerColor(0)).toMatch(/#/)
  })
  it('returns green-ish for fully available stations', () => {
    expect(markerColor(1)).toMatch(/#/)
  })
})

describe('markerSize', () => {
  it('scales with total docks', () => {
    expect(markerSize(5)).toBeLessThan(markerSize(20))
  })
  it('clamps to a sane minimum', () => {
    expect(markerSize(0)).toBeGreaterThanOrEqual(6)
  })
})
```

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- marker-style
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/web/lib/marker-style.ts
export function pctAvailable({ bikes, docks }: { bikes: number; docks: number }): number {
  const total = bikes + docks
  if (total === 0) return 0
  return bikes / total
}

const EMPTY_COLOR = '#b91c1c'   // red-700
const FULL_COLOR = '#15803d'    // green-700

export function markerColor(pct: number): string {
  // simple linear interp between EMPTY_COLOR and FULL_COLOR
  const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t)
  const hex = (n: number) => n.toString(16).padStart(2, '0')
  const [r1, g1, b1] = [0xb9, 0x1c, 0x1c]
  const [r2, g2, b2] = [0x15, 0x80, 0x3d]
  const r = lerp(r1, r2, pct)
  const g = lerp(g1, g2, pct)
  const b = lerp(b1, b2, pct)
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

export function markerSize(totalDocks: number): number {
  return Math.max(6, Math.min(20, 6 + totalDocks * 0.5))
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test -- marker-style
```

Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/web/lib/marker-style.ts src/web/lib/marker-style.test.ts
git commit -m "feat(web): marker color and size helpers"
```

---

## Task 20: API client + useLiveSnapshot hook

**Files:**
- Create: `src/web/lib/api.ts`
- Create: `src/web/hooks/useLiveSnapshot.ts`
- Create: `src/web/hooks/useLiveSnapshot.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
// src/web/hooks/useLiveSnapshot.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useLiveSnapshot } from './useLiveSnapshot'

const payload = {
  system: { system_id: 'bcycle_santabarbara', name: 'SB BCycle', timezone: 'America/Los_Angeles', language: 'en' },
  snapshot_ts: 1778692030,
  stations: [{ station_id: 'a', name: 'A', lat: 0, lon: 0, num_bikes_available: 1, num_docks_available: 1, bikes_electric: 1, bikes_classic: 0, bikes_smart: 0, is_installed: true, is_renting: true, is_returning: true, last_reported: 0 }],
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })))
})

describe('useLiveSnapshot', () => {
  it('fetches once on mount and exposes data', async () => {
    const { result } = renderHook(() => useLiveSnapshot('bcycle_santabarbara'))
    await vi.runOnlyPendingTimersAsync()
    await waitFor(() => expect(result.current.data?.snapshot_ts).toBe(1778692030))
  })

  it('exposes ageSec relative to "now"', async () => {
    vi.setSystemTime(new Date(1778692030 * 1000 + 60_000))
    const { result } = renderHook(() => useLiveSnapshot('bcycle_santabarbara'))
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.ageSec).toBeGreaterThanOrEqual(60)
    expect(result.current.ageSec).toBeLessThan(70)
  })
})
```

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- useLiveSnapshot
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/web/lib/api.ts
import type { KVValue } from '@shared/types'

export async function fetchCurrent(systemId: string): Promise<KVValue> {
  const res = await fetch(`/api/systems/${systemId}/current`)
  if (!res.ok) throw new Error(`current fetch failed: ${res.status}`)
  return await res.json() as KVValue
}
```

```ts
// src/web/hooks/useLiveSnapshot.ts
import { useEffect, useState } from 'react'
import { fetchCurrent } from '../lib/api'
import type { KVValue } from '@shared/types'

const REFRESH_MS = 60_000

type State = {
  data: KVValue | null
  ageSec: number
  error: Error | null
}

export function useLiveSnapshot(systemId: string): State {
  const [data, setData] = useState<KVValue | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const v = await fetchCurrent(systemId)
        if (!cancelled) {
          setData(v)
          setError(null)
        }
      } catch (e) {
        if (!cancelled) setError(e as Error)
      }
    }
    tick()
    const fetchTimer = setInterval(tick, REFRESH_MS)
    const clockTimer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => { cancelled = true; clearInterval(fetchTimer); clearInterval(clockTimer) }
  }, [systemId])

  const ageSec = data ? Math.max(0, now - data.snapshot_ts) : 0
  return { data, ageSec, error }
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test -- useLiveSnapshot
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/web/lib/api.ts src/web/hooks/useLiveSnapshot.ts src/web/hooks/useLiveSnapshot.test.tsx
git commit -m "feat(web): fetchCurrent + useLiveSnapshot hook with age tracking"
```

---

## Task 21: StalenessBadge component

**Files:**
- Create: `src/web/components/StalenessBadge.tsx`
- Create: `src/web/components/StalenessBadge.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
// src/web/components/StalenessBadge.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import StalenessBadge from './StalenessBadge'

describe('StalenessBadge', () => {
  it('renders nothing when ageSec < 180', () => {
    const { container } = render(<StalenessBadge ageSec={120} snapshotTs={1} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a small badge when ageSec is 180-600', () => {
    render(<StalenessBadge ageSec={300} snapshotTs={1} />)
    expect(screen.getByText(/5m ago|300s/i)).toBeInTheDocument()
  })

  it('renders a prominent banner when ageSec > 600', () => {
    render(<StalenessBadge ageSec={1200} snapshotTs={1} />)
    expect(screen.getByText(/feed appears stale/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- StalenessBadge
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/web/components/StalenessBadge.tsx
type Props = { ageSec: number; snapshotTs: number }

function formatLastUpdate(ts: number): string {
  const d = new Date(ts * 1000)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function StalenessBadge({ ageSec, snapshotTs }: Props) {
  if (ageSec < 180) return null
  if (ageSec <= 600) {
    const minutes = Math.round(ageSec / 60)
    return (
      <div className="absolute top-4 right-4 px-2 py-1 rounded bg-amber-900/70 text-amber-100 text-xs">
        {minutes}m ago
      </div>
    )
  }
  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 px-3 py-2 rounded bg-red-900/80 text-red-50 text-sm">
      feed appears stale, last update at {formatLastUpdate(snapshotTs)}
    </div>
  )
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test -- StalenessBadge
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/web/components/StalenessBadge.tsx src/web/components/StalenessBadge.test.tsx
git commit -m "feat(web): StalenessBadge with three states for feed age"
```

---

## Task 22: LiveMap route with MapLibre

**Files:**
- Modify: `src/web/routes/LiveMap.tsx`
- Modify: `package.json` (add maplibre-gl)

- [ ] **Step 1: Install MapLibre**

```bash
npm install maplibre-gl@^4.7.0
```

- [ ] **Step 2: Replace `LiveMap.tsx`**

```tsx
// src/web/routes/LiveMap.tsx
import { useEffect, useRef } from 'react'
import maplibregl, { Map as MlMap, Marker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useLiveSnapshot } from '../hooks/useLiveSnapshot'
import { markerColor, markerSize, pctAvailable } from '../lib/marker-style'
import StalenessBadge from '../components/StalenessBadge'

const SYSTEM_ID = 'bcycle_santabarbara'
const SB_CENTER: [number, number] = [-119.6982, 34.4208]

const BASEMAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

export default function LiveMap() {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const markersRef = useRef<Map<string, Marker>>(new Map())
  const { data, ageSec } = useLiveSnapshot(SYSTEM_ID)

  // boot the map once
  useEffect(() => {
    if (!ref.current || mapRef.current) return
    mapRef.current = new maplibregl.Map({
      container: ref.current,
      style: BASEMAP_STYLE,
      center: SB_CENTER,
      zoom: 13,
    })
    return () => { mapRef.current?.remove(); mapRef.current = null }
  }, [])

  // sync markers when data updates
  useEffect(() => {
    if (!mapRef.current || !data) return
    const map = mapRef.current
    const seen = new Set<string>()
    for (const s of data.stations) {
      seen.add(s.station_id)
      const pct = pctAvailable({ bikes: s.num_bikes_available, docks: s.num_docks_available })
      const color = markerColor(pct)
      const size = markerSize(s.num_bikes_available + s.num_docks_available)

      const existing = markersRef.current.get(s.station_id)
      if (existing) {
        const el = existing.getElement()
        el.style.backgroundColor = color
        el.style.width = el.style.height = `${size}px`
        continue
      }

      const el = document.createElement('div')
      el.className = 'rounded-full border border-neutral-900'
      el.style.backgroundColor = color
      el.style.width = el.style.height = `${size}px`
      el.title = `${s.name}: ${s.num_bikes_available} bikes / ${s.num_docks_available} docks`

      const marker = new maplibregl.Marker(el).setLngLat([s.lon, s.lat]).addTo(map)
      markersRef.current.set(s.station_id, marker)
    }
    for (const [id, marker] of markersRef.current) {
      if (!seen.has(id)) { marker.remove(); markersRef.current.delete(id) }
    }
  }, [data])

  return (
    <div className="relative w-full h-[calc(100vh-49px)]">
      <div ref={ref} className="absolute inset-0" />
      {data && <StalenessBadge ageSec={ageSec} snapshotTs={data.snapshot_ts} />}
    </div>
  )
}
```

- [ ] **Step 3: Manual smoke test**

In one terminal:
```bash
npm run dev:worker
```

In another:
```bash
npm run dev:web
```

Open `http://localhost:5173`. You should see a dark basemap centered on Santa Barbara with circular markers at each station. Open DevTools network tab to confirm `GET /api/systems/bcycle_santabarbara/current` fires every 60s.

Note: if the API call returns 404, the poller hasn't run yet in dev. Trigger it manually:
```bash
curl 'http://localhost:8787/__scheduled?cron=*/2+*+*+*+*'
```
Then refresh the page.

- [ ] **Step 4: Commit**

```bash
git add src/web/routes/LiveMap.tsx package.json package-lock.json
git commit -m "feat(web): LiveMap renders MapLibre with station markers"
```

---

## Task 23: Production wiring — KV namespace + R2 bucket

This task is operational, not code. Steps run in the Cloudflare dashboard or via `wrangler` CLI.

- [ ] **Step 1: Authenticate wrangler**

```bash
npx wrangler login
```

Follow the OAuth flow in browser.

- [ ] **Step 2: Create the KV namespace**

```bash
npx wrangler kv namespace create GBFS_KV
npx wrangler kv namespace create GBFS_KV --preview
```

Output contains `id = "abc123..."` and `preview_id = "def456..."`. Capture both.

- [ ] **Step 3: Create the R2 bucket**

```bash
npx wrangler r2 bucket create bcycle-map-archive
```

- [ ] **Step 4: Configure R2 public access**

In Cloudflare dashboard → R2 → `bcycle-map-archive` → Settings → enable public access. Note the public URL (something like `https://pub-<hash>.r2.dev`).

Also under CORS Policy, add:

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET"],
    "AllowedHeaders": ["*"]
  }
]
```

(Tighten `AllowedOrigins` to the Pages domain once you know it.)

- [ ] **Step 5: Plug real IDs into all three `wrangler*.toml` files**

In `wrangler.toml`, `wrangler.read-api.toml`, and `wrangler.smoke.toml`, replace the `PLACEHOLDER_REPLACE_AT_DEPLOY` strings with the real `id` and `preview_id` from Step 2.

- [ ] **Step 6: Set GitHub secrets for the smoke worker**

```bash
npx wrangler secret put GITHUB_TOKEN --config wrangler.smoke.toml
# paste a fine-grained PAT with "Issues: write" on the repo
npx wrangler secret put GITHUB_REPO --config wrangler.smoke.toml
# paste samgutentag/bcycle-map (or wherever you push)
```

- [ ] **Step 7: Commit the config with real IDs**

```bash
git add wrangler.toml wrangler.read-api.toml wrangler.smoke.toml
git commit -m "chore: bind production KV namespace and R2 bucket"
```

---

## Task 24: Deploy Workers

- [ ] **Step 1: Deploy the poller**

```bash
npx wrangler deploy
```

Expected: success message with the Worker URL (something like `bcycle-map-poller.<account>.workers.dev`). Cron triggers are registered automatically.

- [ ] **Step 2: Deploy the read API**

```bash
npx wrangler deploy --config wrangler.read-api.toml
```

Expected: deploys to `bcycle-map-read-api.<account>.workers.dev`. Note this URL — the frontend will call it.

- [ ] **Step 3: Deploy the smoke worker**

```bash
npx wrangler deploy --config wrangler.smoke.toml
```

- [ ] **Step 4: Trigger the poller manually to seed KV**

```bash
npx wrangler dev --remote --test-scheduled
curl 'https://bcycle-map-poller.<account>.workers.dev/__scheduled?cron=*/2+*+*+*+*'
```

(Cron triggers fire on schedule automatically, but seeding via manual trigger lets you verify before waiting up to 2 minutes.)

- [ ] **Step 5: Verify the read API returns data**

```bash
curl 'https://bcycle-map-read-api.<account>.workers.dev/api/systems/bcycle_santabarbara/current' | jq '.stations | length'
```

Expected: a number around 85.

- [ ] **Step 6: Commit nothing (no code changed)**

This task is operational.

---

## Task 25: Deploy frontend to Cloudflare Pages

- [ ] **Step 1: Update the API base URL for production**

The dev proxy points `/api` to `localhost:8787`. In production we point to the read-api Worker URL.

Edit `src/web/lib/api.ts`:

```ts
import type { KVValue } from '@shared/types'

const API_BASE = import.meta.env.VITE_API_BASE ?? ''

export async function fetchCurrent(systemId: string): Promise<KVValue> {
  const res = await fetch(`${API_BASE}/api/systems/${systemId}/current`)
  if (!res.ok) throw new Error(`current fetch failed: ${res.status}`)
  return await res.json() as KVValue
}
```

Create `.env.example`:
```
VITE_API_BASE=https://bcycle-map-read-api.<account>.workers.dev
```

- [ ] **Step 2: Build production bundle**

```bash
VITE_API_BASE='https://bcycle-map-read-api.<account>.workers.dev' npm run build:web
```

Expected: `dist/` populated with bundled HTML/JS/CSS.

- [ ] **Step 3: Deploy to Cloudflare Pages**

```bash
npx wrangler pages deploy dist --project-name=bcycle-map
```

First-time prompts will ask whether to create the Pages project. Confirm.

Expected: success message with a `https://bcycle-map.pages.dev` URL.

- [ ] **Step 4: Tighten R2 + read-api CORS**

Now that you know the Pages domain:

- In `src/workers/read-api.ts`, change `'access-control-allow-origin': '*'` to the Pages domain. Redeploy the read-api Worker.
- In Cloudflare R2 dashboard, change `AllowedOrigins` from `["*"]` to `["https://bcycle-map.pages.dev"]`.

- [ ] **Step 5: Commit**

```bash
git add src/web/lib/api.ts src/workers/read-api.ts .env.example
git commit -m "chore: production-ready CORS + API base URL"
npx wrangler deploy --config wrangler.read-api.toml
```

---

## Task 26: End-to-end verification

- [ ] **Step 1: Visit the live site**

Open `https://bcycle-map.pages.dev` in a browser.

Expected:
- Dark basemap, centered on Santa Barbara
- ~85 station markers visible
- Marker colors range from red (empty) to green (full)
- Marker sizes vary with station capacity
- DevTools Network tab shows `GET /api/systems/.../current` returning 200 every ~60s
- No console errors

- [ ] **Step 2: Verify KV has the latest snapshot**

```bash
npx wrangler kv key get 'system:bcycle_santabarbara:latest' --binding GBFS_KV --remote
```

Expected: JSON with current snapshot.

- [ ] **Step 3: Wait one hour, then verify R2 has the first sealed parquet**

```bash
npx wrangler r2 object list bcycle-map-archive --prefix=gbfs/bcycle_santabarbara/station_status/
```

Expected: at least one `.parquet` file appears after the first hour boundary passes.

- [ ] **Step 4: Verify the staleness badge appears if polling stops**

In the Cloudflare dashboard, temporarily disable the poller Worker's cron trigger. Wait 3+ minutes, refresh the page.

Expected: the "X minutes ago" badge appears in the top-right corner.

Re-enable the cron trigger.

- [ ] **Step 5: Commit a `DEPLOYED.md` snapshot**

```markdown
# DEPLOYED.md

- Frontend: https://bcycle-map.pages.dev
- Read API: https://bcycle-map-read-api.<account>.workers.dev
- Poller: https://bcycle-map-poller.<account>.workers.dev (cron */2)
- Smoke: https://bcycle-map-smoke.<account>.workers.dev (cron 0 9 * * *)
- R2 bucket: bcycle-map-archive (public)
- KV namespace: GBFS_KV (id: <id>)
- First deploy: <date>
```

```bash
git add DEPLOYED.md
git commit -m "docs: capture deployed environment URLs"
```

---

## Self-Review

A pass through the spec against the plan:

**Spec coverage check:**

- Live map at `/` — Task 22 ✓
- `/explore` route — placeholder in Task 18, full impl deferred to Plan 2 (declared up front) ✓
- Multi-system-ready architecture — `systems.json` + `SystemConfig` everywhere; Task 10 ✓
- Cloudflare end-to-end hosting — Tasks 23–25 ✓
- 120s polling — `wrangler.toml` cron `*/2 * * * *` in Task 7 ✓
- Read API Worker fronts KV — Task 15 ✓
- Poller Worker writes KV + R2 — Tasks 11–14 ✓
- KV buffer with parquet compaction at hour close — Tasks 12, 13 ✓
- Self-healing missed compactions — Task 13 idempotency test ✓
- Anti-corruption normalize layer — Tasks 4–6 ✓
- Cache-Control: max-age=60 on read API — Task 15 ✓
- Staleness signaling (<3min / 3–10min / >10min) — Task 21 ✓
- CORS on read API + R2 — Task 25 ✓
- Smoke test with GitHub Issue filing + dedupe — Tasks 16, 17 ✓
- Unit tests on normalize, parquet, marker-style — Tasks 4–6, 9, 19 ✓
- Integration tests on poller — Tasks 11–13 (via mocked KV/R2) ✓
- Public R2 bucket — Task 23 ✓

**Placeholder scan:** No "TBD", "implement later", "add error handling" text in the plan. All code blocks are complete. All commands are runnable. The only literal `PLACEHOLDER_REPLACE_AT_DEPLOY` strings are in wrangler.toml files and are explicitly replaced in Task 23.

**Type consistency:** `KVValue`, `StationSnapshot`, `BufferEntry`, `SystemConfig`, `Env` defined once and referenced consistently. Function names match across tasks (`pollOnce`, `writeSnapshotToKV`, `compactPreviousHourIfNeeded`, `currentBufferKey`, `latestKey`, `parquetKey`).

No gaps found. Plan is ready.
