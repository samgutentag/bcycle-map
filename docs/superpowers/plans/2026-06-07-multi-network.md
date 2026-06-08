# Multi-network Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the app from a single hardcoded BCycle Santa Barbara network to any GBFS network (next: RedBike Cincinnati), where adding a network is one row in `systems.json`.

**Architecture:** The backend is already namespaced by `system_id` (poller loops `getSystems()`, KV/R2 keys and read-API routes carry the id). The work is: (1) a server-side `compute-corridors` script that derives a per-system corridor artifact (committed override → GBFS regions → directional fallback) plus a cross-system index; (2) a geo-aware `/api/systems` read-API endpoint; (3) a frontend refactor replacing six hardcoded `SYSTEM_ID` constants with a resolved `SystemContext` + network picker, artifact-driven corridors, auto-fit map, and metadata-driven branding.

**Tech Stack:** TypeScript, React 18, MapLibre GL, Cloudflare Workers (poller + read-api), R2 (artifacts via `@aws-sdk/client-s3` in scripts, `R2Bucket` binding in workers), KV, Vitest + Testing Library, tsx for compute scripts, GitHub Actions (cron).

**Spec:** `docs/superpowers/specs/2026-06-07-multi-network-design.md`

---

## Conventions (read before starting)

- **Quotes/semicolons:** single quotes, no semicolons (matches the codebase).
- **Tests:** `npx vitest run <path>` for one file; `npm test` for all. Pure logic is unit-tested directly (no S3/KV mocking) — mirror `scripts/compute-leaderboards.test.ts`.
- **Commit style:** conventional commits, one per task. End each commit body with the `Co-Authored-By` trailer.
- **R2 artifact read (frontend):** `fetch(\`${r2Base}/gbfs/${systemId}/<artifact>.json\`)` where `r2Base = import.meta.env.VITE_R2_PUBLIC_URL ?? 'https://pub-83059e704dd64536a5166ab289eb42e5.r2.dev'`.
- **R2 artifact write (script):** `S3Client({ region: 'auto', endpoint: \`https://${accountId}.r2.cloudflarestorage.com\`, credentials })` + `PutObjectCommand`.

## File structure (what gets created / changed)

**New (backend / shared):**
- `src/shared/corridors.ts` — corridor types + pure derivation (regions, directional, tier-selection with partial-override merge).
- `src/shared/corridors.test.ts` — unit tests for the above.
- `scripts/compute-corridors.ts` — per-system: fetch GBFS feeds, derive corridors, write `gbfs/{id}/corridors.json`; emit `gbfs/systems-index.json`.
- `scripts/compute-corridors.test.ts` — unit tests for the script's pure helpers.
- `corridors/bcycle_santabarbara.json` — committed override (curated SB assignments).
- `scripts/generate-sb-corridors-override.ts` — one-shot generator that snapshots the legacy `assignCorridor` rules into the override file.
- `.github/workflows/corridors.yml` — daily cron running the compute script.
- `src/shared/systems-index.ts` — the `SystemIndexEntry` type + `nearestSystem` pure helper (shared by worker + frontend).
- `src/shared/systems-index.test.ts`.

**New (frontend):**
- `src/web/lib/systems-api.ts` — `fetchSystems()` calling `/api/systems`.
- `src/web/context/SystemContext.tsx` — `SystemProvider` + `useSystem` + resolver.
- `src/web/context/SystemContext.test.tsx`.
- `src/web/components/NetworkPicker.tsx` + `.test.tsx`.
- `src/web/hooks/useCorridors.ts` + `.test.tsx`.

**Modified:**
- `src/workers/read-api.ts` — add `GET /api/systems` (geo nearest).
- `src/workers/read-api.test.ts` — add geo-endpoint tests.
- `systems.json` — add Cincinnati row.
- `src/web/config/corridors.ts` — replace static SB tables with artifact-driven types/helpers.
- `src/web/config/corridors.test.ts` — rewrite for artifact-driven helpers.
- `src/web/components/MapFilterChips.tsx` — drive chips from loaded corridor list (props), not static imports.
- `src/web/components/MapFilterChips.test.tsx` — update.
- `src/web/routes/{LiveMap,Activity,Explore,FlowMap,StationDetails,RouteCheck}.tsx` — use `useSystem()` instead of hardcoded `SYSTEM_ID`; LiveMap also uses `useCorridors`.
- `src/web/App.tsx` — wrap in `SystemProvider`, add `NetworkPicker` to header.
- `src/web/components/BrandMark.tsx`, `src/web/components/AboutModal.tsx` — branding from active-system metadata.

## Phases (each ends shippable)

- **Phase A** — shared corridor logic (pure, no I/O). Ships nothing user-visible; fully unit-tested.
- **Phase B** — compute script + CI + SB override + index. Produces R2 artifacts; UI unchanged (still uses client-side corridors).
- **Phase C** — `/api/systems` geo endpoint. Backend-only; independently testable.
- **Phase D** — frontend system context + picker + de-hardcode routes. Multi-network UX without corridor change.
- **Phase E** — artifact-driven corridors on the frontend.
- **Phase F** — branding from metadata.
- **Phase G** — seed Cincinnati + end-to-end verification.

---

## Data contracts (used across tasks)

```ts
// src/shared/corridors.ts
export type Corridor = { id: string; label: string }

export type CorridorArtifact = {
  generated_at: number
  source: 'override' | 'regions' | 'derived' | 'override+derived' | 'override+regions'
  corridors: Corridor[]                 // ordered, for the chip dropdown
  assignments: Record<string, string>   // station_id -> corridor id
}

// A committed override file (corridors/<systemId>.json) is partial:
export type CorridorOverride = {
  corridors: Corridor[]                 // named corridors this system curates
  assignments: Record<string, string>   // station_id -> corridor id (subset of stations)
}

// Minimal station shape the derivation needs.
export type CorridorStation = { station_id: string; name: string; lat: number; lon: number; region_id?: string }

// GBFS system_regions.json shape (only the fields we use).
export type GbfsRegion = { region_id: string; region_name: string }
```

```ts
// src/shared/systems-index.ts
export type SystemIndexEntry = {
  systemId: string
  name: string
  gbfsUrl: string
  rentalUrl: string | null      // GBFS system_information.url
  timezone: string
  centroid: [number, number]    // [lon, lat]
  bbox: [number, number, number, number] // [minLon, minLat, maxLon, maxLat]
  stationCount: number
}
```

---

## Task A1: Corridor types + directional derivation

**Files:**
- Create: `src/shared/corridors.ts`
- Test: `src/shared/corridors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/corridors.test.ts
import { describe, it, expect } from 'vitest'
import { deriveDirectionalCorridors, type CorridorStation } from './corridors'

const st = (id: string, lat: number, lon: number): CorridorStation => ({ station_id: id, name: id, lat, lon })

describe('deriveDirectionalCorridors', () => {
  it('returns an empty artifact for no stations', () => {
    const out = deriveDirectionalCorridors([])
    expect(out.corridors).toEqual([])
    expect(out.assignments).toEqual({})
  })

  it('labels stations by compass sector around the centroid, plus a central core', () => {
    // Centroid is (0,0). Place clearly-N, clearly-E, clearly-S, clearly-W, and one near-center.
    const stations = [
      st('n', 1.0, 0.0),
      st('e', 0.0, 1.0),
      st('s', -1.0, 0.0),
      st('w', 0.0, -1.0),
      st('c', 0.001, 0.001),
    ]
    const out = deriveDirectionalCorridors(stations)
    expect(out.assignments['n']).toBe('north')
    expect(out.assignments['e']).toBe('east')
    expect(out.assignments['s']).toBe('south')
    expect(out.assignments['w']).toBe('west')
    expect(out.assignments['c']).toBe('central')
    // Only emits corridors that actually have stations, in a stable order.
    expect(out.corridors.map(c => c.id)).toEqual(['north', 'east', 'south', 'west', 'central'])
    expect(out.corridors.find(c => c.id === 'north')!.label).toBe('North')
  })

  it('is deterministic for the same input', () => {
    const stations = [st('a', 0.5, 0.5), st('b', -0.5, -0.5)]
    expect(deriveDirectionalCorridors(stations)).toEqual(deriveDirectionalCorridors(stations))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/corridors.test.ts`
Expected: FAIL — cannot import `deriveDirectionalCorridors` (module/exports missing).

- [ ] **Step 3: Write the implementation**

```ts
// src/shared/corridors.ts
export type Corridor = { id: string; label: string }

export type CorridorArtifact = {
  generated_at: number
  source: 'override' | 'regions' | 'derived' | 'override+derived' | 'override+regions'
  corridors: Corridor[]
  assignments: Record<string, string>
}

export type CorridorOverride = {
  corridors: Corridor[]
  assignments: Record<string, string>
}

export type CorridorStation = { station_id: string; name: string; lat: number; lon: number; region_id?: string }
export type GbfsRegion = { region_id: string; region_name: string }

// Stable presentation order for directional sectors.
const SECTOR_ORDER = ['north', 'east', 'south', 'west', 'central'] as const
const SECTOR_LABEL: Record<string, string> = {
  north: 'North',
  east: 'East',
  south: 'South',
  west: 'West',
  central: 'Central',
}

function validStations(stations: CorridorStation[]): CorridorStation[] {
  return stations.filter(
    s => Number.isFinite(s.lat) && Number.isFinite(s.lon) && s.lat !== 0 && s.lon !== 0,
  )
}

/**
 * Fallback corridors when a system has neither a curated override nor usable
 * GBFS regions. Splits stations into N/E/S/W sectors by bearing from the
 * centroid, with a 'central' core for stations within 25% of the mean radius.
 * Deterministic: no randomness, no time input.
 */
export function deriveDirectionalCorridors(stations: CorridorStation[]): Omit<CorridorArtifact, 'generated_at' | 'source'> {
  const valid = validStations(stations)
  if (valid.length === 0) return { corridors: [], assignments: {} }

  const cLat = valid.reduce((s, x) => s + x.lat, 0) / valid.length
  const cLon = valid.reduce((s, x) => s + x.lon, 0) / valid.length

  const dist = (s: CorridorStation) => Math.hypot(s.lat - cLat, s.lon - cLon)
  const meanRadius = valid.reduce((s, x) => s + dist(x), 0) / valid.length
  const coreRadius = meanRadius * 0.25

  const assignments: Record<string, string> = {}
  for (const s of valid) {
    if (dist(s) <= coreRadius) {
      assignments[s.station_id] = 'central'
      continue
    }
    // Bearing: atan2(dLon, dLat) — 0 = north, +90 = east.
    const angle = (Math.atan2(s.lon - cLon, s.lat - cLat) * 180) / Math.PI
    const a = (angle + 360) % 360
    if (a >= 315 || a < 45) assignments[s.station_id] = 'north'
    else if (a < 135) assignments[s.station_id] = 'east'
    else if (a < 225) assignments[s.station_id] = 'south'
    else assignments[s.station_id] = 'west'
  }

  const present = new Set(Object.values(assignments))
  const corridors: Corridor[] = SECTOR_ORDER.filter(id => present.has(id)).map(id => ({ id, label: SECTOR_LABEL[id]! }))
  return { corridors, assignments }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/corridors.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/corridors.ts src/shared/corridors.test.ts
git commit -m "feat(corridors): shared directional-corridor derivation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task A2: Corridors from GBFS regions

**Files:**
- Modify: `src/shared/corridors.ts`
- Test: `src/shared/corridors.test.ts`

- [ ] **Step 1: Add the failing test**

```ts
// append to src/shared/corridors.test.ts
import { corridorsFromRegions } from './corridors'

describe('corridorsFromRegions', () => {
  const regions = [
    { region_id: 'r9', region_name: 'Central Business District' },
    { region_id: 'r66', region_name: 'Clifton' },
  ]

  it('maps each station to its region by region_id and labels with region_name', () => {
    const stations: CorridorStation[] = [
      { station_id: 'a', name: 'A', lat: 39.1, lon: -84.5, region_id: 'r9' },
      { station_id: 'b', name: 'B', lat: 39.13, lon: -84.51, region_id: 'r66' },
    ]
    const out = corridorsFromRegions(stations, regions)
    expect(out).not.toBeNull()
    expect(out!.assignments).toEqual({ a: 'r9', b: 'r66' })
    expect(out!.corridors).toEqual([
      { id: 'r9', label: 'Central Business District' },
      { id: 'r66', label: 'Clifton' },
    ])
  })

  it('only emits corridors that have at least one assigned station, in region order', () => {
    const stations: CorridorStation[] = [
      { station_id: 'a', name: 'A', lat: 39.1, lon: -84.5, region_id: 'r66' },
    ]
    const out = corridorsFromRegions(stations, regions)
    expect(out!.corridors).toEqual([{ id: 'r66', label: 'Clifton' }])
  })

  it('returns null when no station carries a usable region_id (the SB case)', () => {
    const stations: CorridorStation[] = [
      { station_id: 'a', name: 'A', lat: 34.42, lon: -119.7 },        // no region_id
      { station_id: 'b', name: 'B', lat: 34.42, lon: -119.7, region_id: 'r-unknown' }, // not in regions
    ]
    expect(corridorsFromRegions(stations, regions)).toBeNull()
  })

  it('returns null when the regions list is empty', () => {
    expect(corridorsFromRegions([{ station_id: 'a', name: 'A', lat: 1, lon: 1, region_id: 'r9' }], [])).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/corridors.test.ts`
Expected: FAIL — `corridorsFromRegions` not exported.

- [ ] **Step 3: Implement**

```ts
// append to src/shared/corridors.ts

/**
 * Build corridors from GBFS system_regions + per-station region_id. Returns
 * null when the feed's regions are unusable for this system — either no
 * regions, or no station carries a region_id that resolves to a named region
 * (e.g. Santa Barbara lists a regions feed but its stations have no
 * region_id). A null return signals the caller to fall through to the next
 * tier.
 */
export function corridorsFromRegions(
  stations: CorridorStation[],
  regions: GbfsRegion[],
): Omit<CorridorArtifact, 'generated_at' | 'source'> | null {
  if (!Array.isArray(regions) || regions.length === 0) return null
  const nameById = new Map(regions.map(r => [r.region_id, r.region_name]))

  const assignments: Record<string, string> = {}
  for (const s of stations) {
    if (s.region_id && nameById.has(s.region_id)) {
      assignments[s.station_id] = s.region_id
    }
  }
  if (Object.keys(assignments).length === 0) return null

  const used = new Set(Object.values(assignments))
  const corridors: Corridor[] = regions
    .filter(r => used.has(r.region_id))
    .map(r => ({ id: r.region_id, label: r.region_name }))
  return { corridors, assignments }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/corridors.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/corridors.ts src/shared/corridors.test.ts
git commit -m "feat(corridors): derive corridors from GBFS system_regions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task A3: Tier selection with partial-override merge

**Files:**
- Modify: `src/shared/corridors.ts`
- Test: `src/shared/corridors.test.ts`

This is the heart of the feature: pick the best source, and let a partial committed override win per-station while unassigned stations fall through to regions/derived.

- [ ] **Step 1: Add the failing test**

```ts
// append to src/shared/corridors.test.ts
import { selectCorridors, type CorridorOverride } from './corridors'

describe('selectCorridors', () => {
  const NOW = 1_750_000_000

  it('derived-only when no override and no usable regions', () => {
    const stations: CorridorStation[] = [
      { station_id: 'n', name: 'n', lat: 1, lon: 0 },
      { station_id: 's', name: 's', lat: -1, lon: 0 },
    ]
    const out = selectCorridors({ stations, regions: [], override: null, now: NOW })
    expect(out.source).toBe('derived')
    expect(out.generated_at).toBe(NOW)
    expect(Object.keys(out.assignments).sort()).toEqual(['n', 's'])
  })

  it('regions-only when regions are usable and no override', () => {
    const stations: CorridorStation[] = [
      { station_id: 'a', name: 'a', lat: 39.1, lon: -84.5, region_id: 'r9' },
    ]
    const out = selectCorridors({ stations, regions: [{ region_id: 'r9', region_name: 'CBD' }], override: null, now: NOW })
    expect(out.source).toBe('regions')
    expect(out.assignments).toEqual({ a: 'r9' })
  })

  it('override wins per-station; unassigned stations fall through to derived', () => {
    const stations: CorridorStation[] = [
      { station_id: 'curated', name: 'curated', lat: 1, lon: 0 },   // in override
      { station_id: 'newbie', name: 'newbie', lat: -1, lon: 0 },    // NOT in override -> derived
    ]
    const override: CorridorOverride = {
      corridors: [{ id: 'waterfront', label: 'Waterfront' }],
      assignments: { curated: 'waterfront' },
    }
    const out = selectCorridors({ stations, regions: [], override, now: NOW })
    expect(out.source).toBe('override+derived')
    expect(out.assignments['curated']).toBe('waterfront')
    expect(out.assignments['newbie']).toBeTruthy()            // got a directional fallback
    expect(out.assignments['newbie']).not.toBe('waterfront')
    // The override's corridor appears first, then any fallback corridors actually used.
    expect(out.corridors[0]).toEqual({ id: 'waterfront', label: 'Waterfront' })
    expect(out.corridors.some(c => c.id === out.assignments['newbie'])).toBe(true)
  })

  it('override is pure (source "override") when it covers every station', () => {
    const stations: CorridorStation[] = [{ station_id: 'curated', name: 'c', lat: 1, lon: 0 }]
    const override: CorridorOverride = {
      corridors: [{ id: 'waterfront', label: 'Waterfront' }],
      assignments: { curated: 'waterfront' },
    }
    const out = selectCorridors({ stations, regions: [], override, now: NOW })
    expect(out.source).toBe('override')
    expect(out.corridors).toEqual([{ id: 'waterfront', label: 'Waterfront' }])
  })

  it('override falls through to regions when regions are usable', () => {
    const stations: CorridorStation[] = [
      { station_id: 'curated', name: 'c', lat: 39.1, lon: -84.5, region_id: 'r9' },
      { station_id: 'newbie', name: 'n', lat: 39.2, lon: -84.6, region_id: 'r9' },
    ]
    const override: CorridorOverride = { corridors: [{ id: 'special', label: 'Special' }], assignments: { curated: 'special' } }
    const out = selectCorridors({ stations, regions: [{ region_id: 'r9', region_name: 'CBD' }], override, now: NOW })
    expect(out.source).toBe('override+regions')
    expect(out.assignments['curated']).toBe('special')
    expect(out.assignments['newbie']).toBe('r9')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/corridors.test.ts`
Expected: FAIL — `selectCorridors` not exported.

- [ ] **Step 3: Implement**

```ts
// append to src/shared/corridors.ts

type SelectArgs = {
  stations: CorridorStation[]
  regions: GbfsRegion[]
  override: CorridorOverride | null
  now: number
}

/**
 * Choose the corridor source for one system, highest precedence first:
 *   1. committed override (partial — wins per-station)
 *   2. GBFS regions (when stations carry usable region_id)
 *   3. directional fallback
 *
 * The override is intentionally partial: curated stations keep their hand
 * authored corridor, and any station the override doesn't name falls through
 * to the next usable tier so newly-added stations still get categorized.
 */
export function selectCorridors({ stations, regions, override, now }: SelectArgs): CorridorArtifact {
  const regionResult = corridorsFromRegions(stations, regions)
  const fallback = regionResult ?? deriveDirectionalCorridors(stations)
  const fallbackKind: 'regions' | 'derived' = regionResult ? 'regions' : 'derived'

  if (!override || Object.keys(override.assignments).length === 0) {
    return { generated_at: now, source: fallbackKind, corridors: fallback.corridors, assignments: fallback.assignments }
  }

  // Merge: override assignments win; fill the rest from the fallback tier.
  const assignments: Record<string, string> = {}
  let usedFallback = false
  for (const s of stations) {
    const o = override.assignments[s.station_id]
    if (o) {
      assignments[s.station_id] = o
    } else if (fallback.assignments[s.station_id]) {
      assignments[s.station_id] = fallback.assignments[s.station_id]!
      usedFallback = true
    }
  }

  // Corridor list: override corridors first (in their given order), then any
  // fallback corridors that ended up used, de-duplicated by id.
  const used = new Set(Object.values(assignments))
  const seen = new Set<string>()
  const corridors: Corridor[] = []
  for (const c of override.corridors) {
    if (used.has(c.id) && !seen.has(c.id)) { corridors.push(c); seen.add(c.id) }
  }
  for (const c of fallback.corridors) {
    if (used.has(c.id) && !seen.has(c.id)) { corridors.push(c); seen.add(c.id) }
  }

  const source: CorridorArtifact['source'] = usedFallback ? `override+${fallbackKind}` : 'override'
  return { generated_at: now, source, corridors, assignments }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/corridors.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/corridors.ts src/shared/corridors.test.ts
git commit -m "feat(corridors): tier selection with partial-override merge

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task A4: Systems-index type + nearest helper

**Files:**
- Create: `src/shared/systems-index.ts`
- Test: `src/shared/systems-index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/systems-index.test.ts
import { describe, it, expect } from 'vitest'
import { nearestSystem, type SystemIndexEntry } from './systems-index'

const entry = (systemId: string, lon: number, lat: number): SystemIndexEntry => ({
  systemId, name: systemId, gbfsUrl: '', rentalUrl: null, timezone: 'UTC',
  centroid: [lon, lat], bbox: [lon, lat, lon, lat], stationCount: 1,
})

const SB = entry('bcycle_santabarbara', -119.7, 34.42)
const CINCY = entry('bcycle_cincyredbike', -84.51, 39.10)

describe('nearestSystem', () => {
  it('returns the closest system to a coordinate', () => {
    expect(nearestSystem([SB, CINCY], { lat: 39.1, lon: -84.5 })!.systemId).toBe('bcycle_cincyredbike')
    expect(nearestSystem([SB, CINCY], { lat: 34.4, lon: -119.7 })!.systemId).toBe('bcycle_santabarbara')
  })

  it('returns null when the list is empty', () => {
    expect(nearestSystem([], { lat: 0, lon: 0 })).toBeNull()
  })

  it('returns null when the coordinate is missing/invalid', () => {
    expect(nearestSystem([SB], null)).toBeNull()
    expect(nearestSystem([SB], { lat: NaN, lon: 0 })).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/systems-index.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// src/shared/systems-index.ts
export type SystemIndexEntry = {
  systemId: string
  name: string
  gbfsUrl: string
  rentalUrl: string | null
  timezone: string
  centroid: [number, number]              // [lon, lat]
  bbox: [number, number, number, number]  // [minLon, minLat, maxLon, maxLat]
  stationCount: number
}

export type LatLon = { lat: number; lon: number } | null

/**
 * Closest system to `coord` by squared great-circle-ish distance. Uses a
 * cheap equirectangular approximation (good enough to disambiguate cities
 * that are hundreds of km apart). Returns null on empty list or bad input.
 */
export function nearestSystem(entries: SystemIndexEntry[], coord: LatLon): SystemIndexEntry | null {
  if (!entries.length) return null
  if (!coord || !Number.isFinite(coord.lat) || !Number.isFinite(coord.lon)) return null

  let best: SystemIndexEntry | null = null
  let bestD = Infinity
  for (const e of entries) {
    const [lon, lat] = e.centroid
    const dLat = lat - coord.lat
    const dLon = (lon - coord.lon) * Math.cos((coord.lat * Math.PI) / 180)
    const d = dLat * dLat + dLon * dLon
    if (d < bestD) { bestD = d; best = e }
  }
  return best
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/systems-index.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/systems-index.ts src/shared/systems-index.test.ts
git commit -m "feat(systems-index): index entry type + nearest-system helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task B1: Generate the Santa Barbara override file

The legacy `assignCorridor` rules (in `src/web/config/corridors.ts`) auto-categorize SB stations. We snapshot them into a committed override so SB keeps its curated names after corridors move server-side. A one-shot generator fetches the live SB snapshot, runs the legacy rules, and writes `corridors/bcycle_santabarbara.json`.

**Files:**
- Create: `scripts/generate-sb-corridors-override.ts`
- Create: `corridors/bcycle_santabarbara.json` (output, committed)

- [ ] **Step 1: Write the generator**

```ts
// scripts/generate-sb-corridors-override.ts
/**
 * One-shot: snapshot the legacy rule-based SB corridor assignment into a
 * committed override file. Run manually whenever SB's curated corridors
 * should be re-baselined:  npx tsx scripts/generate-sb-corridors-override.ts
 *
 * Reads the live SB snapshot from the read-api, runs the legacy assignCorridor
 * rules + CORRIDOR_ORDER/LABELS, and writes corridors/bcycle_santabarbara.json
 * in the CorridorOverride shape.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { assignCorridor, CORRIDOR_ORDER, CORRIDOR_LABELS } from '../src/web/config/legacy-corridors'
import type { CorridorOverride } from '../src/shared/corridors'

const API_BASE = process.env.API_BASE ?? 'https://bcycle-map-read-api.developer-95b.workers.dev'
const SYSTEM_ID = 'bcycle_santabarbara'

async function main() {
  const res = await fetch(`${API_BASE}/api/systems/${SYSTEM_ID}/current`)
  if (!res.ok) throw new Error(`current fetch failed: ${res.status}`)
  const snap = (await res.json()) as { stations: Array<{ station_id: string; name: string; lat: number; lon: number }> }

  const assignments: Record<string, string> = {}
  for (const s of snap.stations) {
    const c = assignCorridor(s)
    if (c) assignments[s.station_id] = c
  }

  const override: CorridorOverride = {
    corridors: CORRIDOR_ORDER.map(id => ({ id, label: CORRIDOR_LABELS[id] })),
    assignments,
  }

  mkdirSync('corridors', { recursive: true })
  writeFileSync('corridors/bcycle_santabarbara.json', JSON.stringify(override, null, 2) + '\n')
  console.log(`wrote corridors/bcycle_santabarbara.json: ${Object.keys(assignments).length} stations, ${override.corridors.length} corridors`)
}

main().catch(err => { console.error(err); process.exit(1) })
```

- [ ] **Step 2: Preserve the legacy rules as an importable module**

The generator imports `legacy-corridors`. Copy the current rule logic out of `src/web/config/corridors.ts` into a stable module before Phase E rewrites that file.

Run:
```bash
git mv src/web/config/corridors.ts src/web/config/legacy-corridors.ts
```
Then in `src/web/config/legacy-corridors.ts`, the file already exports `assignCorridor`, `CORRIDOR_ORDER`, `CORRIDOR_LABELS`, `CorridorId`, `buildCorridorMap`, `isCorridorId`. Leave them as-is. (Phase E creates a fresh `src/web/config/corridors.ts` for the artifact-driven API; consumers are migrated there.)

Update the import in the moved test for now so the suite stays green:
```bash
git mv src/web/config/corridors.test.ts src/web/config/legacy-corridors.test.ts
```
Then edit `src/web/config/legacy-corridors.test.ts` line 1's import path: change `from './corridors'` to `from './legacy-corridors'`. Also update the two current consumers' imports so the app still builds:
- `src/web/routes/LiveMap.tsx` line 19: `from '../config/corridors'` → `from '../config/legacy-corridors'`
- `src/web/components/MapFilterChips.tsx` line 3: `from '../config/corridors'` → `from '../config/legacy-corridors'`

- [ ] **Step 3: Run the generator and the full suite**

Run: `npx tsx scripts/generate-sb-corridors-override.ts`
Expected: writes `corridors/bcycle_santabarbara.json` with ~100 station assignments and 11 corridors.

Run: `npm test`
Expected: PASS (legacy tests run under the new path; app imports resolve).

- [ ] **Step 4: Sanity-check the output**

Run: `cat corridors/bcycle_santabarbara.json | head -20`
Expected: JSON with `corridors` array (waterfront, cabrillo, …) and an `assignments` map of station_id → corridor id.

- [ ] **Step 5: Commit**

```bash
git add corridors/bcycle_santabarbara.json scripts/generate-sb-corridors-override.ts \
  src/web/config/legacy-corridors.ts src/web/config/legacy-corridors.test.ts \
  src/web/routes/LiveMap.tsx src/web/components/MapFilterChips.tsx
git commit -m "feat(corridors): snapshot SB curated corridors to committed override

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task B2: compute-corridors script (pure helpers tested)

**Files:**
- Create: `scripts/compute-corridors.ts`
- Test: `scripts/compute-corridors.test.ts`

The script iterates `getSystems()`, fetches each system's GBFS feeds (discovery → station_information, system_information, system_regions), reads an optional committed override, calls `selectCorridors`, writes `gbfs/{id}/corridors.json`, and accumulates a `SystemIndexEntry` for `gbfs/systems-index.json`. Per the codebase convention, only the **pure helpers** are unit-tested; the S3 I/O path is exercised manually / in CI.

- [ ] **Step 1: Write the failing test (pure helpers)**

```ts
// scripts/compute-corridors.test.ts
import { describe, it, expect } from 'vitest'
import { resolveFeeds, indexEntryFor } from './compute-corridors'

describe('resolveFeeds', () => {
  it('builds a name->url map from a GBFS discovery document', () => {
    const discovery = { data: { en: { feeds: [
      { name: 'station_information', url: 'http://x/si.json' },
      { name: 'system_regions', url: 'http://x/sr.json' },
    ] } } }
    const feeds = resolveFeeds(discovery)
    expect(feeds.station_information).toBe('http://x/si.json')
    expect(feeds.system_regions).toBe('http://x/sr.json')
    expect(feeds.station_status).toBeUndefined()
  })
})

describe('indexEntryFor', () => {
  it('computes centroid + bbox + count from station coords', () => {
    const entry = indexEntryFor(
      { system_id: 'sys', name: 'Sys', gbfs_url: 'http://g', version: '1.1' },
      { system_id: 'sys', name: 'Sys', timezone: 'UTC', language: 'en', url: 'http://rent' },
      [
        { station_id: 'a', name: 'a', lat: 0, lon: 0 },
        { station_id: 'b', name: 'b', lat: 2, lon: 4 },
      ],
    )
    expect(entry.systemId).toBe('sys')
    expect(entry.rentalUrl).toBe('http://rent')
    expect(entry.centroid).toEqual([2, 1])        // [meanLon, meanLat]
    expect(entry.bbox).toEqual([0, 0, 4, 2])      // [minLon, minLat, maxLon, maxLat]
    expect(entry.stationCount).toBe(2)
  })

  it('ignores 0/0 and non-finite coords when computing bounds', () => {
    const entry = indexEntryFor(
      { system_id: 'sys', name: 'Sys', gbfs_url: 'http://g', version: '1.1' },
      { system_id: 'sys', name: 'Sys', timezone: 'UTC', language: 'en', url: null },
      [
        { station_id: 'a', name: 'a', lat: 0, lon: 0 },     // dropped
        { station_id: 'b', name: 'b', lat: 10, lon: 20 },
        { station_id: 'c', name: 'c', lat: 12, lon: 24 },
      ],
    )
    expect(entry.centroid).toEqual([22, 11])
    expect(entry.stationCount).toBe(3)             // count is all stations; bounds use valid only
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/compute-corridors.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the script**

```ts
// scripts/compute-corridors.ts
/**
 * Per-system corridor derivation + cross-system index.
 *
 * For each system in systems.json: fetch the GBFS discovery doc, resolve the
 * station_information / system_information / system_regions sub-feeds, read an
 * optional committed override (corridors/<systemId>.json), run the shared
 * selectCorridors tiering, and write gbfs/<systemId>/corridors.json to R2.
 * Also emits gbfs/systems-index.json (one entry per system) for the picker
 * and the geo-aware /api/systems endpoint.
 *
 * Runs daily (corridors change rarely). Env: CF_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY, R2_BUCKET.
 */
import { readFileSync } from 'node:fs'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { fetchJsonWithRetry } from '../src/workers/lib/gbfs-client'
import { getSystems, type SystemConfig } from '../src/shared/systems'
import {
  selectCorridors,
  type CorridorOverride,
  type CorridorStation,
  type GbfsRegion,
} from '../src/shared/corridors'
import type { SystemIndexEntry } from '../src/shared/systems-index'

type Discovery = { data: { en: { feeds: Array<{ name: string; url: string }> } } }
type SysInfo = { system_id: string; name: string; timezone: string; language: string; url: string | null }

export function resolveFeeds(discovery: Discovery): Record<string, string> {
  return Object.fromEntries(discovery.data.en.feeds.map(f => [f.name, f.url]))
}

function validCoords(stations: CorridorStation[]): CorridorStation[] {
  return stations.filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon) && s.lat !== 0 && s.lon !== 0)
}

export function indexEntryFor(
  cfg: SystemConfig,
  sys: SysInfo,
  stations: CorridorStation[],
): SystemIndexEntry {
  const valid = validCoords(stations)
  const lats = valid.map(s => s.lat)
  const lons = valid.map(s => s.lon)
  const meanLon = lons.reduce((a, b) => a + b, 0) / (lons.length || 1)
  const meanLat = lats.reduce((a, b) => a + b, 0) / (lats.length || 1)
  return {
    systemId: cfg.system_id,
    name: cfg.name,
    gbfsUrl: cfg.gbfs_url,
    rentalUrl: sys.url ?? null,
    timezone: sys.timezone,
    centroid: [meanLon, meanLat],
    bbox: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
    stationCount: stations.length,
  }
}

function readOverride(systemId: string): CorridorOverride | null {
  try {
    return JSON.parse(readFileSync(`corridors/${systemId}.json`, 'utf8')) as CorridorOverride
  } catch {
    return null  // no committed override for this system
  }
}

function normalizeStations(raw: any): CorridorStation[] {
  const arr = raw?.data?.stations
  if (!Array.isArray(arr)) throw new Error('station_information.data.stations missing')
  return arr.map((s: any) => ({
    station_id: String(s.station_id),
    name: String(s.name ?? ''),
    lat: Number(s.lat),
    lon: Number(s.lon),
    region_id: typeof s.region_id === 'string' ? s.region_id : undefined,
  }))
}

function normalizeRegions(raw: any): GbfsRegion[] {
  const arr = raw?.data?.regions
  if (!Array.isArray(arr)) return []
  return arr.map((r: any) => ({ region_id: String(r.region_id), region_name: String(r.region_name) }))
}

function normalizeSysInfo(raw: any): SysInfo {
  const d = raw?.data ?? {}
  return {
    system_id: String(d.system_id ?? ''),
    name: String(d.name ?? ''),
    timezone: String(d.timezone ?? 'UTC'),
    language: String(d.language ?? 'en'),
    url: typeof d.url === 'string' ? d.url : null,
  }
}

async function processSystem(cfg: SystemConfig, now: number): Promise<{ entry: SystemIndexEntry; corridors: string }> {
  const discovery = await fetchJsonWithRetry<Discovery>(cfg.gbfs_url)
  const feeds = resolveFeeds(discovery)
  if (!feeds.station_information || !feeds.system_information) {
    throw new Error(`Missing required sub-feed for ${cfg.system_id}`)
  }
  const [siRaw, sysRaw, regionsRaw] = await Promise.all([
    fetchJsonWithRetry(feeds.station_information),
    fetchJsonWithRetry(feeds.system_information),
    feeds.system_regions ? fetchJsonWithRetry(feeds.system_regions).catch(() => null) : Promise.resolve(null),
  ])
  const stations = normalizeStations(siRaw)
  const sys = normalizeSysInfo(sysRaw)
  const regions = regionsRaw ? normalizeRegions(regionsRaw) : []
  const override = readOverride(cfg.system_id)

  const artifact = selectCorridors({ stations, regions, override, now })
  console.log(`${cfg.system_id}: source=${artifact.source} corridors=${artifact.corridors.length} assigned=${Object.keys(artifact.assignments).length}/${stations.length}`)
  return { entry: indexEntryFor(cfg, sys, stations), corridors: JSON.stringify(artifact) }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const accountId = process.env.CF_ACCOUNT_ID
    const accessKeyId = process.env.R2_ACCESS_KEY_ID
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
    const bucket = process.env.R2_BUCKET
    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
      throw new Error('Missing one of CF_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET')
    }
    const s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    })
    const now = Math.floor(Date.now() / 1000)
    const index: SystemIndexEntry[] = []

    for (const cfg of getSystems()) {
      try {
        const { entry, corridors } = await processSystem(cfg, now)
        await s3.send(new PutObjectCommand({
          Bucket: bucket,
          Key: `gbfs/${cfg.system_id}/corridors.json`,
          Body: corridors,
          ContentType: 'application/json',
          CacheControl: 'public, max-age=3600',
        }))
        index.push(entry)
        console.log(`wrote gbfs/${cfg.system_id}/corridors.json`)
      } catch (err) {
        console.error(`corridors failed for ${cfg.system_id}:`, err)
      }
    }

    if (index.length === 0) throw new Error('no systems processed; refusing to overwrite index')
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: 'gbfs/systems-index.json',
      Body: JSON.stringify({ generated_at: now, systems: index }),
      ContentType: 'application/json',
      CacheControl: 'public, max-age=3600',
    }))
    console.log(`wrote gbfs/systems-index.json (${index.length} systems)`)
  })().catch(err => { console.error('compute-corridors failed:', err); process.exit(1) })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/compute-corridors.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add an npm script + smoke-run locally**

Edit `package.json` scripts: add `"compute-corridors": "tsx scripts/compute-corridors.ts"` next to the other `compute-*` entries.

Smoke-run against real R2 (requires creds in env). If you don't have creds locally, skip and rely on CI in Task B3 — note that explicitly:
```bash
CF_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=bcycle-map-archive npx tsx scripts/compute-corridors.ts
```
Expected: logs `bcycle_santabarbara: source=override+derived ...` and writes both artifacts.

- [ ] **Step 6: Commit**

```bash
git add scripts/compute-corridors.ts scripts/compute-corridors.test.ts package.json
git commit -m "feat(corridors): compute-corridors script writes per-system artifact + index

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task B3: corridors.yml workflow

**Files:**
- Create: `.github/workflows/corridors.yml`

- [ ] **Step 1: Write the workflow** (mirrors `leaderboards.yml`; no KV creds needed — corridors derive from GBFS, not KV)

```yaml
# .github/workflows/corridors.yml
name: corridors

# Daily derivation of per-system corridor artifacts + the cross-system index.
# Corridors change only when stations/regions change, so daily is plenty.

on:
  schedule:
    - cron: '42 9 * * *'
  workflow_dispatch: {}

permissions:
  contents: read

concurrency:
  group: corridors
  cancel-in-progress: false

jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 1

      - uses: actions/setup-node@v6
        with:
          node-version: '24'
          cache: 'npm'

      - run: npm ci

      - name: Run corridors script
        run: npx tsx scripts/compute-corridors.ts
        env:
          CF_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          R2_BUCKET: ${{ secrets.R2_BUCKET }}
```

- [ ] **Step 2: Trigger once to seed the artifacts**

After this commit is on `main`, run the workflow manually:
```bash
gh workflow run corridors.yml
gh run watch
```
Expected: success; `gbfs/bcycle_santabarbara/corridors.json` and `gbfs/systems-index.json` exist in R2.

Verify (R2 public URL):
```bash
curl -s https://pub-83059e704dd64536a5166ab289eb42e5.r2.dev/gbfs/systems-index.json | head -c 400
```
Expected: JSON `{ "generated_at": ..., "systems": [ { "systemId": "bcycle_santabarbara", ... } ] }`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/corridors.yml
git commit -m "ci(corridors): daily corridors + systems-index workflow

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task C1: `GET /api/systems` (geo-aware nearest)

**Files:**
- Modify: `src/workers/read-api.ts`
- Test: `src/workers/read-api.test.ts`

The endpoint reads `gbfs/systems-index.json` from R2, reads request geo via `(req as any).cf.latitude/longitude` (strings, like the existing `cf.country` usage), and returns `{ systems, nearestId }`.

- [ ] **Step 1: Write the failing test**

```ts
// append cases inside src/workers/read-api.test.ts (after existing describe body,
// before the final closing brace). Reuse the file's makeEnv() helper.

it('GET /api/systems returns the index with nearestId from request geo', async () => {
  const index = {
    generated_at: 1,
    systems: [
      { systemId: 'bcycle_santabarbara', name: 'SB', gbfsUrl: '', rentalUrl: null, timezone: 'UTC', centroid: [-119.7, 34.42], bbox: [0,0,0,0], stationCount: 1 },
      { systemId: 'bcycle_cincyredbike', name: 'Cincy', gbfsUrl: '', rentalUrl: null, timezone: 'UTC', centroid: [-84.51, 39.10], bbox: [0,0,0,0], stationCount: 1 },
    ],
  }
  const env = makeEnv({ r2Get: { 'gbfs/systems-index.json': JSON.stringify(index) } })
  const req = new Request('https://example/api/systems')
  ;(req as any).cf = { latitude: '39.1', longitude: '-84.5' }
  const res = await worker.fetch(req, env)
  expect(res.status).toBe(200)
  const body = await res.json() as { systems: any[]; nearestId: string | null }
  expect(body.systems).toHaveLength(2)
  expect(body.nearestId).toBe('bcycle_cincyredbike')
  expect(res.headers.get('access-control-allow-origin')).toBeTruthy()
})

it('GET /api/systems returns nearestId null when geo is absent', async () => {
  const index = { generated_at: 1, systems: [
    { systemId: 'bcycle_santabarbara', name: 'SB', gbfsUrl: '', rentalUrl: null, timezone: 'UTC', centroid: [-119.7, 34.42], bbox: [0,0,0,0], stationCount: 1 },
  ] }
  const env = makeEnv({ r2Get: { 'gbfs/systems-index.json': JSON.stringify(index) } })
  const res = await worker.fetch(new Request('https://example/api/systems'), env)
  expect(res.status).toBe(200)
  const body = await res.json() as { systems: any[]; nearestId: string | null }
  expect(body.nearestId).toBeNull()
})

it('GET /api/systems returns empty list + null when the index is missing', async () => {
  const env = makeEnv()  // r2Get null -> get() returns null
  const res = await worker.fetch(new Request('https://example/api/systems'), env)
  expect(res.status).toBe(200)
  const body = await res.json() as { systems: any[]; nearestId: string | null }
  expect(body.systems).toEqual([])
  expect(body.nearestId).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/workers/read-api.test.ts`
Expected: FAIL — `/api/systems` returns 404 (route not handled), so assertions fail.

- [ ] **Step 3: Implement the handler**

In `src/workers/read-api.ts`:

Add the import near the top (after the existing imports):
```ts
import { nearestSystem, type SystemIndexEntry } from '../shared/systems-index'
```

Add the route regex with the others (after `GEOCODE_RE`):
```ts
const SYSTEMS_RE = /^\/api\/systems$/
```

Add the handler function (place near `handleInsights`):
```ts
async function handleSystems(req: Request, env: Env): Promise<Response> {
  let systems: SystemIndexEntry[] = []
  try {
    const obj = await env.GBFS_R2.get('gbfs/systems-index.json')
    if (obj) {
      const parsed = JSON.parse(await obj.text()) as { systems?: SystemIndexEntry[] }
      if (Array.isArray(parsed.systems)) systems = parsed.systems
    }
  } catch (err) {
    console.error('systems index read failed:', err)
  }
  const cf = (req as any).cf || {}
  const lat = Number(cf.latitude)
  const lon = Number(cf.longitude)
  const coord = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null
  const nearest = nearestSystem(systems, coord)
  return jsonResponse({ systems, nearestId: nearest?.systemId ?? null }, 200, 'max-age=300')
}
```

Wire it in `fetch` (add before the `CURRENT_RE` block so `/api/systems` is matched before the parameterized `/api/systems/:id/...` routes):
```ts
    if (url.pathname.match(SYSTEMS_RE)) {
      return handleSystems(req, env)
    }
```

Note: `CURRENT_RE` etc. require a trailing `/current` segment, so ordering is not strictly required — but matching the exact `/api/systems` first is clearer.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/workers/read-api.test.ts`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/workers/read-api.ts src/workers/read-api.test.ts
git commit -m "feat(read-api): GET /api/systems with edge-geo nearest detection

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Deploy the worker (so the frontend can consume it in Phase D)**

This worker deploys via `.github/workflows/deploy-workers.yml` on push to `main` touching worker files. After merging, confirm:
```bash
curl -s https://bcycle-map-read-api.developer-95b.workers.dev/api/systems | head -c 400
```
Expected: `{ "systems": [...], "nearestId": "..." }`.

---

## Task D1: Frontend systems API client

**Files:**
- Create: `src/web/lib/systems-api.ts`

- [ ] **Step 1: Write the client** (no test — thin fetch wrapper; covered via the context test in D2 with a mocked fetch)

```ts
// src/web/lib/systems-api.ts
import type { SystemIndexEntry } from '@shared/systems-index'

const API_BASE = import.meta.env.VITE_API_BASE ?? ''

export type SystemsResponse = { systems: SystemIndexEntry[]; nearestId: string | null }

export async function fetchSystems(): Promise<SystemsResponse> {
  const res = await fetch(`${API_BASE}/api/systems`)
  if (!res.ok) throw new Error(`systems fetch failed: ${res.status}`)
  return (await res.json()) as SystemsResponse
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (confirms the `@shared/systems-index` path alias resolves).

- [ ] **Step 3: Commit**

```bash
git add src/web/lib/systems-api.ts
git commit -m "feat(web): systems API client

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task D2: SystemContext + resolver

**Files:**
- Create: `src/web/context/SystemContext.tsx`
- Test: `src/web/context/SystemContext.test.tsx`

Resolver precedence: **localStorage last-pick (if still in the list) → nearestId from `/api/systems` → first system → default constant**. Persists the active id to localStorage on change. Mirrors the `useUnitSystem` Context+Provider+hook shape.

- [ ] **Step 1: Write the failing test**

```tsx
// src/web/context/SystemContext.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { SystemProvider, useSystem, SYSTEM_LS_KEY, resolveActiveSystem } from './SystemContext'
import type { SystemsResponse } from '../lib/systems-api'

const RESP: SystemsResponse = {
  systems: [
    { systemId: 'bcycle_santabarbara', name: 'SB', gbfsUrl: '', rentalUrl: null, timezone: 'UTC', centroid: [-119.7, 34.42], bbox: [0,0,0,0], stationCount: 1 },
    { systemId: 'bcycle_cincyredbike', name: 'Cincy', gbfsUrl: '', rentalUrl: null, timezone: 'UTC', centroid: [-84.51, 39.10], bbox: [0,0,0,0], stationCount: 1 },
  ],
  nearestId: 'bcycle_cincyredbike',
}

describe('resolveActiveSystem (pure)', () => {
  const ids = ['bcycle_santabarbara', 'bcycle_cincyredbike']
  it('prefers a persisted pick that is still valid', () => {
    expect(resolveActiveSystem({ persisted: 'bcycle_cincyredbike', nearestId: 'bcycle_santabarbara', ids, fallback: 'bcycle_santabarbara' })).toBe('bcycle_cincyredbike')
  })
  it('ignores a persisted pick no longer in the list', () => {
    expect(resolveActiveSystem({ persisted: 'gone', nearestId: 'bcycle_cincyredbike', ids, fallback: 'bcycle_santabarbara' })).toBe('bcycle_cincyredbike')
  })
  it('falls back to nearest, then first, then default', () => {
    expect(resolveActiveSystem({ persisted: null, nearestId: 'bcycle_cincyredbike', ids, fallback: 'bcycle_santabarbara' })).toBe('bcycle_cincyredbike')
    expect(resolveActiveSystem({ persisted: null, nearestId: null, ids, fallback: 'bcycle_santabarbara' })).toBe('bcycle_santabarbara')
    expect(resolveActiveSystem({ persisted: null, nearestId: null, ids: [], fallback: 'bcycle_santabarbara' })).toBe('bcycle_santabarbara')
  })
})

function Probe() {
  const { systemId, systems } = useSystem()
  return <div data-testid="probe">{systemId}|{systems.length}</div>
}

describe('SystemProvider', () => {
  beforeEach(() => { window.localStorage.clear() })
  afterEach(() => { vi.restoreAllMocks() })

  it('resolves to nearest on first load and renders children immediately with the default', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(RESP), { status: 200 }))
    render(<SystemProvider defaultSystemId="bcycle_santabarbara"><Probe /></SystemProvider>)
    // children render right away (default) — never blocked on the network
    expect(screen.getByTestId('probe').textContent).toMatch(/^bcycle_santabarbara\|/)
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('bcycle_cincyredbike|2'))
    expect(window.localStorage.getItem(SYSTEM_LS_KEY)).toBe('bcycle_cincyredbike')
  })

  it('honors a persisted pick over nearest', async () => {
    window.localStorage.setItem(SYSTEM_LS_KEY, 'bcycle_santabarbara')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(RESP), { status: 200 }))
    render(<SystemProvider defaultSystemId="bcycle_santabarbara"><Probe /></SystemProvider>)
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('bcycle_santabarbara|2'))
  })

  it('keeps the default when the fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    render(<SystemProvider defaultSystemId="bcycle_santabarbara"><Probe /></SystemProvider>)
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('bcycle_santabarbara|0'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/web/context/SystemContext.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```tsx
// src/web/context/SystemContext.tsx
import { createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode } from 'react'
import { fetchSystems } from '../lib/systems-api'
import type { SystemIndexEntry } from '@shared/systems-index'

export const SYSTEM_LS_KEY = 'bcycle-map:system'

type SystemContextValue = {
  systemId: string
  systems: SystemIndexEntry[]
  activeSystem: SystemIndexEntry | null
  setSystemId: (id: string) => void
}

const SystemContext = createContext<SystemContextValue | null>(null)

function readPersisted(): string | null {
  if (typeof window === 'undefined') return null
  try { return window.localStorage.getItem(SYSTEM_LS_KEY) } catch { return null }
}

function persist(id: string): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(SYSTEM_LS_KEY, id) } catch { /* private mode */ }
}

/** Pure resolver — precedence: valid persisted → nearest → first → fallback. */
export function resolveActiveSystem(args: {
  persisted: string | null
  nearestId: string | null
  ids: string[]
  fallback: string
}): string {
  const { persisted, nearestId, ids, fallback } = args
  if (persisted && ids.includes(persisted)) return persisted
  if (nearestId && ids.includes(nearestId)) return nearestId
  if (ids.length > 0) return ids[0]!
  return fallback
}

type ProviderProps = { children: ReactNode; defaultSystemId: string }

export function SystemProvider({ children, defaultSystemId }: ProviderProps) {
  // Render immediately with the default; resolve asynchronously so the map
  // never blocks on the /api/systems round-trip.
  const [systemId, setSystemIdState] = useState<string>(() => readPersisted() ?? defaultSystemId)
  const [systems, setSystems] = useState<SystemIndexEntry[]>([])

  useEffect(() => {
    let cancelled = false
    fetchSystems()
      .then(resp => {
        if (cancelled) return
        setSystems(resp.systems)
        const resolved = resolveActiveSystem({
          persisted: readPersisted(),
          nearestId: resp.nearestId,
          ids: resp.systems.map(s => s.systemId),
          fallback: defaultSystemId,
        })
        setSystemIdState(resolved)
        persist(resolved)
      })
      .catch(() => { /* keep default; offline or endpoint missing */ })
    return () => { cancelled = true }
  }, [defaultSystemId])

  const setSystemId = useCallback((id: string) => {
    setSystemIdState(id)
    persist(id)
  }, [])

  const value = useMemo<SystemContextValue>(() => ({
    systemId,
    systems,
    activeSystem: systems.find(s => s.systemId === systemId) ?? null,
    setSystemId,
  }), [systemId, systems, setSystemId])

  return <SystemContext.Provider value={value}>{children}</SystemContext.Provider>
}

/**
 * Active system. Outside a provider (component unit tests that don't wrap the
 * tree) it falls back to the SB default so components don't crash.
 */
export function useSystem(): SystemContextValue {
  const ctx = useContext(SystemContext)
  if (ctx) return ctx
  return {
    systemId: 'bcycle_santabarbara',
    systems: [],
    activeSystem: null,
    setSystemId: () => {},
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/web/context/SystemContext.test.tsx`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/web/context/SystemContext.tsx src/web/context/SystemContext.test.tsx
git commit -m "feat(web): SystemContext with geo/localStorage resolver

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task D3: NetworkPicker component

**Files:**
- Create: `src/web/components/NetworkPicker.tsx`
- Test: `src/web/components/NetworkPicker.test.tsx`

A compact `<select>` of networks (hidden when fewer than 2), styled like the existing corridor chip's native-select pattern. Reads/writes the active system via `useSystem`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/web/components/NetworkPicker.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from '../theme'
import NetworkPicker from './NetworkPicker'
import { SystemContextTestHarness } from '../context/SystemContext'

// A tiny harness that injects a controllable context value.
function renderWithSystems(value: Parameters<typeof SystemContextTestHarness>[0]['value']) {
  return render(
    <ThemeProvider>
      <SystemContextTestHarness value={value}>
        <NetworkPicker />
      </SystemContextTestHarness>
    </ThemeProvider>,
  )
}

const two = [
  { systemId: 'bcycle_santabarbara', name: 'Santa Barbara BCycle', gbfsUrl: '', rentalUrl: null, timezone: 'UTC', centroid: [0,0] as [number,number], bbox: [0,0,0,0] as [number,number,number,number], stationCount: 1 },
  { systemId: 'bcycle_cincyredbike', name: 'Red Bike - Cincinnati', gbfsUrl: '', rentalUrl: null, timezone: 'UTC', centroid: [0,0] as [number,number], bbox: [0,0,0,0] as [number,number,number,number], stationCount: 1 },
]

describe('NetworkPicker', () => {
  it('renders nothing when fewer than 2 systems', () => {
    const { container } = renderWithSystems({ systemId: 'bcycle_santabarbara', systems: [two[0]!], activeSystem: two[0]!, setSystemId: vi.fn() })
    expect(container.querySelector('select')).toBeNull()
  })

  it('lists all systems and calls setSystemId on change', () => {
    const setSystemId = vi.fn()
    renderWithSystems({ systemId: 'bcycle_santabarbara', systems: two, activeSystem: two[0]!, setSystemId })
    const select = screen.getByTestId('network-picker') as HTMLSelectElement
    expect(select.value).toBe('bcycle_santabarbara')
    expect(screen.getByRole('option', { name: 'Red Bike - Cincinnati' })).toBeTruthy()
    fireEvent.change(select, { target: { value: 'bcycle_cincyredbike' } })
    expect(setSystemId).toHaveBeenCalledWith('bcycle_cincyredbike')
  })
})
```

- [ ] **Step 2: Add a test harness export to SystemContext**

The test references `SystemContextTestHarness`. Add it to `src/web/context/SystemContext.tsx` so components can be tested with an injected value (the codebase prefers explicit test seams, cf. `UnitSystemProvider`'s `initialValue`):

```tsx
// append to src/web/context/SystemContext.tsx
type HarnessProps = { value: SystemContextValue; children: ReactNode }
/** Test seam: inject a fixed context value. Not used in production. */
export function SystemContextTestHarness({ value, children }: HarnessProps) {
  return <SystemContext.Provider value={value}>{children}</SystemContext.Provider>
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/web/components/NetworkPicker.test.tsx`
Expected: FAIL — `NetworkPicker` module missing.

- [ ] **Step 4: Implement**

```tsx
// src/web/components/NetworkPicker.tsx
import { Text, useTheme } from '@audius/harmony'
import { useSystem } from '../context/SystemContext'

/**
 * Network switcher for the header. Hidden when only one network exists so the
 * single-system experience is unchanged. Native <select> for keyboard a11y,
 * styled to match the corridor chip pattern.
 */
export default function NetworkPicker() {
  const theme = useTheme()
  const { systemId, systems, setSystemId } = useSystem()
  if (systems.length < 2) return null

  return (
    <div
      css={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: theme.cornerRadius.s,
        border: `1px solid ${theme.color.border.default}`,
        background: theme.color.background.surface1,
        padding: `${theme.spacing.xs}px ${theme.spacing.s}px`,
      }}
    >
      <Text variant="label" size="s" strength="strong" color="default" css={{ whiteSpace: 'nowrap', pointerEvents: 'none' }}>
        {systems.find(s => s.systemId === systemId)?.name ?? 'Network'}
      </Text>
      <select
        data-testid="network-picker"
        aria-label="Choose bike network"
        value={systemId}
        onChange={ev => setSystemId(ev.target.value)}
        css={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', border: 'none', background: 'transparent' }}
      >
        {systems.map(s => (
          <option key={s.systemId} value={s.systemId}>{s.name}</option>
        ))}
      </select>
    </div>
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/web/components/NetworkPicker.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/web/components/NetworkPicker.tsx src/web/components/NetworkPicker.test.tsx src/web/context/SystemContext.tsx
git commit -m "feat(web): NetworkPicker header control

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task D4: Wire provider + picker into App

**Files:**
- Modify: `src/web/App.tsx`

- [ ] **Step 1: Add imports** (after the existing component imports, ~line 17)

```tsx
import { SystemProvider } from './context/SystemContext'
import NetworkPicker from './components/NetworkPicker'
```

- [ ] **Step 2: Render the picker in the header**

In `AppHeader`, inside the right-hand `<Flex alignItems="center" gap="s">` (currently holding `ThemeToggle` + the About button, ~line 138), add `NetworkPicker` as the first child:
```tsx
        <Flex alignItems="center" gap="s">
          <NetworkPicker />
          <ThemeToggle />
```

- [ ] **Step 3: Wrap the app in SystemProvider**

In the default-exported `App()`, wrap the existing `<UnitSystemProvider>` subtree (replace its opening/closing tags' nesting so `SystemProvider` is the outer provider):
```tsx
export default function App() {
  const [aboutOpen, setAboutOpen] = useState(false)
  return (
    <SystemProvider defaultSystemId="bcycle_santabarbara">
      <UnitSystemProvider>
        {/* …existing Flex tree unchanged… */}
      </UnitSystemProvider>
    </SystemProvider>
  )
}
```

- [ ] **Step 4: Verify build + existing tests**

Run: `npm run typecheck && npm test`
Expected: PASS. The picker renders nothing yet (only SB until Cincinnati is added in Phase G), so the header is visually unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/web/App.tsx
git commit -m "feat(web): mount SystemProvider + NetworkPicker in app shell

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task D5: De-hardcode SYSTEM_ID in the six routes

Replace each `const SYSTEM_ID = 'bcycle_santabarbara'` with `const SYSTEM_ID = useSystem().systemId`. Because the value now comes from a hook, it must be read **inside** the component body (the existing constants are module-level). Each route already has a component function; move the declaration in.

Do these one file at a time; run `npm run typecheck` after each.

- [ ] **Step 1: Activity.tsx**

Remove the module-level `const SYSTEM_ID = 'bcycle_santabarbara'` (line 12). Add `import { useSystem } from '../context/SystemContext'`. Inside the component, before the first use (`useLiveSnapshot(SYSTEM_ID)` ~line 17), add:
```tsx
  const { systemId: SYSTEM_ID } = useSystem()
```

- [ ] **Step 2: Explore.tsx** — same change (remove line 36 const; add hook import; add `const { systemId: SYSTEM_ID } = useSystem()` inside the component before line 101).

- [ ] **Step 3: FlowMap.tsx** — remove line 18 const; add hook import; add `const { systemId: SYSTEM_ID } = useSystem()` inside the component before line 30. (Leave `SB_CENTER` for now — handled in Task D6.)

- [ ] **Step 4: StationDetails.tsx** — remove line 38 const; add hook import; add `const { systemId: SYSTEM_ID } = useSystem()` inside the component before line 150 / 365.

- [ ] **Step 5: RouteCheck.tsx** — remove line 35 const; add hook import; add `const { systemId: SYSTEM_ID } = useSystem()` inside the component before line 173.

- [ ] **Step 6: LiveMap.tsx** — remove line 93 const (keep `SB_CENTER` for now); add hook import; add `const { systemId: SYSTEM_ID } = useSystem()` inside the component before its first use (`useLiveSnapshot(SYSTEM_ID)` line 163).

- [ ] **Step 7: Typecheck + tests after the batch**

Run: `npm run typecheck && npm test`
Expected: PASS. Route component tests that render without a `SystemProvider` get the `useSystem()` fallback (`bcycle_santabarbara`), so behavior is unchanged.

- [ ] **Step 8: Commit**

```bash
git add src/web/routes/Activity.tsx src/web/routes/Explore.tsx src/web/routes/FlowMap.tsx \
  src/web/routes/StationDetails.tsx src/web/routes/RouteCheck.tsx src/web/routes/LiveMap.tsx
git commit -m "refactor(web): routes read active system from useSystem()

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task D6: Map center from active system (drop SB_CENTER hardcode)

Both `LiveMap.tsx` and `FlowMap.tsx` boot MapLibre at `SB_CENTER`. The first-data effect in LiveMap already `fitBounds` to the live stations, so the boot center is just a pre-data placeholder. Replace the hardcoded SB constant with the active system's centroid (from `useSystem().activeSystem`), falling back to SB if the index hasn't loaded.

**Files:**
- Modify: `src/web/routes/LiveMap.tsx`, `src/web/routes/FlowMap.tsx`

- [ ] **Step 1: LiveMap.tsx** — replace the `SB_CENTER` constant usage

Remove module-level `const SB_CENTER: [number, number] = [-119.6982, 34.4208]` (line 94). Inside the component, derive a boot center from the active system:
```tsx
  const { systemId: SYSTEM_ID, activeSystem } = useSystem()
  const bootCenter: [number, number] = activeSystem?.centroid ?? [-119.6982, 34.4208]
```
In the boot effect (line ~303), change `center: SB_CENTER,` to `center: bootCenter,`. Add `bootCenter` to nothing — the boot effect is intentionally `[]`-deps (boot once); the placeholder center only matters pre-fit. To avoid a stale-closure lint complaint, capture it via a ref:
```tsx
  const bootCenterRef = useRef(bootCenter)
  bootCenterRef.current = bootCenter
```
and use `center: bootCenterRef.current,` in the boot effect.

Also: when the active system changes, re-fit to the new stations. The existing `boundsSetRef` gates the one-time fit. Add an effect that resets it when `SYSTEM_ID` changes so the camera re-fits to the new network:
```tsx
  useEffect(() => { boundsSetRef.current = false }, [SYSTEM_ID])
```

- [ ] **Step 2: FlowMap.tsx** — same treatment

Remove `const SB_CENTER: [number, number] = [-119.6982, 34.4208]` (line 19). Use `activeSystem?.centroid ?? [-119.6982, 34.4208]` for the map boot center (locate the `new maplibregl.Map({ ... center: SB_CENTER ... })` call and swap it the same way, via a ref if the boot effect is `[]`-deps).

- [ ] **Step 3: Typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/web/routes/LiveMap.tsx src/web/routes/FlowMap.tsx
git commit -m "feat(web): boot map at active system centroid, re-fit on switch

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task E1: useCorridors hook

**Files:**
- Create: `src/web/hooks/useCorridors.ts`
- Test: `src/web/hooks/useCorridors.test.tsx`

Fetches the per-system corridor artifact directly from R2 (same pattern as `useRouteCache`).

- [ ] **Step 1: Write the failing test**

```tsx
// src/web/hooks/useCorridors.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useCorridors } from './useCorridors'
import type { CorridorArtifact } from '@shared/corridors'

const ARTIFACT: CorridorArtifact = {
  generated_at: 1,
  source: 'derived',
  corridors: [{ id: 'north', label: 'North' }],
  assignments: { a: 'north' },
}

afterEach(() => vi.restoreAllMocks())

describe('useCorridors', () => {
  it('fetches the corridor artifact for the system from R2', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(ARTIFACT), { status: 200 }))
    const { result } = renderHook(() => useCorridors('https://r2.example', 'sys'))
    await waitFor(() => expect(result.current.data).not.toBeNull())
    expect(spy).toHaveBeenCalledWith('https://r2.example/gbfs/sys/corridors.json')
    expect(result.current.data!.corridors).toEqual([{ id: 'north', label: 'North' }])
  })

  it('returns null data (not an error) when the artifact is missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not found', { status: 404 }))
    const { result } = renderHook(() => useCorridors('https://r2.example', 'sys'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/web/hooks/useCorridors.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// src/web/hooks/useCorridors.ts
import { useEffect, useState } from 'react'
import type { CorridorArtifact } from '@shared/corridors'

export type CorridorsState = { data: CorridorArtifact | null; loading: boolean }

/**
 * Load the active system's corridor artifact from R2. A missing artifact
 * (404 — e.g. a freshly-added system before the corridors workflow runs) is
 * treated as "no corridors", not an error: the chip filter simply hides.
 */
export function useCorridors(r2Base: string, systemId: string): CorridorsState {
  const [data, setData] = useState<CorridorArtifact | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setData(null)
    fetch(`${r2Base}/gbfs/${systemId}/corridors.json`)
      .then(async r => (r.ok ? ((await r.json()) as CorridorArtifact) : null))
      .then(json => { if (!cancelled) { setData(json); setLoading(false) } })
      .catch(() => { if (!cancelled) { setData(null); setLoading(false) } })
    return () => { cancelled = true }
  }, [r2Base, systemId])

  return { data, loading }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/web/hooks/useCorridors.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/web/hooks/useCorridors.ts src/web/hooks/useCorridors.test.tsx
git commit -m "feat(web): useCorridors loads per-system corridor artifact

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task E2: Artifact-driven corridors config

**Files:**
- Create: `src/web/config/corridors.ts` (fresh — the old one is now `legacy-corridors.ts`)
- Test: `src/web/config/corridors.test.ts`

Provide artifact-driven helpers replacing the static `CORRIDOR_ORDER`/`CORRIDOR_LABELS`/`assignCorridor`/`buildCorridorMap`/`isCorridorId`. `CorridorId` is now just `string`.

- [ ] **Step 1: Write the failing test**

```ts
// src/web/config/corridors.test.ts
import { describe, it, expect } from 'vitest'
import { corridorOrder, corridorLabels, assignmentMap, isCorridorIn } from './corridors'
import type { CorridorArtifact } from '@shared/corridors'

const ART: CorridorArtifact = {
  generated_at: 1,
  source: 'regions',
  corridors: [{ id: 'r9', label: 'CBD' }, { id: 'r66', label: 'Clifton' }],
  assignments: { a: 'r9', b: 'r66' },
}

describe('artifact-driven corridor helpers', () => {
  it('corridorOrder returns ids in artifact order', () => {
    expect(corridorOrder(ART)).toEqual(['r9', 'r66'])
    expect(corridorOrder(null)).toEqual([])
  })
  it('corridorLabels maps id -> label', () => {
    expect(corridorLabels(ART)).toEqual({ r9: 'CBD', r66: 'Clifton' })
    expect(corridorLabels(null)).toEqual({})
  })
  it('assignmentMap returns a Map of station_id -> corridor id', () => {
    const m = assignmentMap(ART)
    expect(m.get('a')).toBe('r9')
    expect(m.get('b')).toBe('r66')
    expect(assignmentMap(null).size).toBe(0)
  })
  it('isCorridorIn checks membership in the artifact', () => {
    expect(isCorridorIn(ART, 'r9')).toBe(true)
    expect(isCorridorIn(ART, 'nope')).toBe(false)
    expect(isCorridorIn(null, 'r9')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/web/config/corridors.test.ts`
Expected: FAIL — module/exports missing.

- [ ] **Step 3: Implement**

```ts
// src/web/config/corridors.ts
import type { CorridorArtifact } from '@shared/corridors'

/** Corridor id is now an arbitrary string (region id, directional sector, or curated id). */
export type CorridorId = string

export function corridorOrder(artifact: CorridorArtifact | null): CorridorId[] {
  return artifact ? artifact.corridors.map(c => c.id) : []
}

export function corridorLabels(artifact: CorridorArtifact | null): Record<CorridorId, string> {
  const out: Record<string, string> = {}
  if (artifact) for (const c of artifact.corridors) out[c.id] = c.label
  return out
}

export function assignmentMap(artifact: CorridorArtifact | null): Map<string, CorridorId> {
  const m = new Map<string, CorridorId>()
  if (artifact) for (const [stationId, cid] of Object.entries(artifact.assignments)) m.set(stationId, cid)
  return m
}

export function isCorridorIn(artifact: CorridorArtifact | null, value: string): value is CorridorId {
  return !!artifact && artifact.corridors.some(c => c.id === value)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/web/config/corridors.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/web/config/corridors.ts src/web/config/corridors.test.ts
git commit -m "feat(web): artifact-driven corridor helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task E3: MapFilterChips driven by loaded corridors

**Files:**
- Modify: `src/web/components/MapFilterChips.tsx`
- Modify: `src/web/components/MapFilterChips.test.tsx`
- Modify: `src/web/lib/map-filters.ts` (widen the corridor type)

`MapFilterChips` currently imports static `CORRIDOR_LABELS`/`CORRIDOR_ORDER`/`isCorridorId`. Change it to accept the corridor list + label map as props, and hide the corridor chip entirely when there are no corridors.

- [ ] **Step 1: Check map-filters.ts corridor typing**

Run: `grep -n "corridor" src/web/lib/map-filters.ts`
The `Filters.corridor` field and `applyMapFilters` reference `CorridorId` from the old config. Update its import to the new `src/web/config/corridors.ts` (`CorridorId` is now `string`). If `map-filters.ts` imported `isCorridorId` for parsing the URL param, replace that call: corridor validation now needs the loaded set, so the URL parse should accept any non-empty string and let the chip's `value`/options constrain it. Change `readFiltersFromSearch` to treat `corridor` as `string | null` (any non-empty value), since validity is enforced at render time by the available options.

Make the minimal edit: in `src/web/lib/map-filters.ts`, change the import line from `'../config/corridors'` to keep `type CorridorId` (now `string`) and drop any `isCorridorId` usage in favor of `value || null`.

- [ ] **Step 2: Update the failing test first**

Replace the static-import expectations in `src/web/components/MapFilterChips.test.tsx`. The component now takes `corridors` (ordered `{id,label}[]`) and renders the chip only when non-empty. Write:

```tsx
// src/web/components/MapFilterChips.test.tsx  (key cases — adapt existing render calls)
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from '../theme'
import MapFilterChips from './MapFilterChips'

const corridors = [{ id: 'r9', label: 'CBD' }, { id: 'r66', label: 'Clifton' }]
const base = {
  minBikes: 0, corridor: null as string | null,
  onMinBikesChange: vi.fn(), onCorridorChange: vi.fn(), onReset: vi.fn(),
  filteredCount: 10, totalCount: 10,
}

const renderChips = (props: Partial<React.ComponentProps<typeof MapFilterChips>>) =>
  render(<ThemeProvider><MapFilterChips {...base} corridors={corridors} {...props} /></ThemeProvider>)

describe('MapFilterChips', () => {
  it('lists corridor options from the corridors prop', () => {
    renderChips({})
    expect(screen.getByRole('option', { name: 'CBD' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Clifton' })).toBeTruthy()
  })
  it('hides the corridor chip when there are no corridors', () => {
    renderChips({ corridors: [] })
    expect(screen.queryByTestId('filter-chip-corridor')).toBeNull()
  })
  it('shows the active corridor label', () => {
    renderChips({ corridor: 'r66' })
    expect(screen.getByText('Corridor: Clifton')).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/web/components/MapFilterChips.test.tsx`
Expected: FAIL — component still expects static imports / no `corridors` prop.

- [ ] **Step 4: Implement the component change**

In `src/web/components/MapFilterChips.tsx`:

Replace the import (line 3):
```tsx
import type { CorridorId } from '../config/corridors'
```

Add `corridors` to `Props` and switch `corridor` to `string | null`:
```tsx
type Props = {
  minBikes: number
  corridor: CorridorId | null
  corridors: Array<{ id: string; label: string }>
  onMinBikesChange: (value: number) => void
  onCorridorChange: (value: CorridorId | null) => void
  onReset: () => void
  filteredCount: number
  totalCount: number
}
```

Build a label lookup at the top of the component:
```tsx
  const labelById = new Map(corridors.map(c => [c.id, c.label]))
```

Replace the active-label expression (was `CORRIDOR_LABELS[corridor]`):
```tsx
            {corridor === null ? 'Corridor: All' : `Corridor: ${labelById.get(corridor) ?? corridor}`}
```

Replace the `<select>` options (was `CORRIDOR_ORDER.map(...)` with `CORRIDOR_LABELS`):
```tsx
            <option value="">All corridors</option>
            {corridors.map(c => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
```

Replace the `onChange` validation (was `isCorridorId(v)`):
```tsx
            onChange={ev => {
              const v = ev.target.value
              onCorridorChange(v === '' ? null : v)
            }}
```

Wrap the entire corridor chip `<div>` (the block rendering the corridor select) in `{corridors.length > 0 && ( … )}` so it disappears for systems with no corridors.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/web/components/MapFilterChips.test.tsx`
Expected: PASS (3 cases).

- [ ] **Step 6: Commit**

```bash
git add src/web/components/MapFilterChips.tsx src/web/components/MapFilterChips.test.tsx src/web/lib/map-filters.ts
git commit -m "refactor(web): MapFilterChips driven by loaded corridor list

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task E4: Wire LiveMap to loaded corridors

**Files:**
- Modify: `src/web/routes/LiveMap.tsx`

Replace the client-side `buildCorridorMap(data.stations)` (from `legacy-corridors`) with the loaded artifact, and pass the corridor list to both `MapFilterChips` instances.

- [ ] **Step 1: Swap the corridor source**

Remove the legacy import (line 19, now `from '../config/legacy-corridors'`). Add:
```tsx
import { assignmentMap } from '../config/corridors'
import { useCorridors } from '../hooks/useCorridors'
```
Add the R2 base near the other consts:
```tsx
const R2_BASE = import.meta.env.VITE_R2_PUBLIC_URL ?? 'https://pub-83059e704dd64536a5166ab289eb42e5.r2.dev'
```

Inside the component, load corridors and build the lookup from the artifact (replace the `buildCorridorMap` `useMemo` at lines ~200-203):
```tsx
  const { data: corridorArtifact } = useCorridors(R2_BASE, SYSTEM_ID)
  const corridorByStation = useMemo(
    () => assignmentMap(corridorArtifact),
    [corridorArtifact],
  )
```

`CorridorId` type usage in `setCorridor` (line 190) still resolves (now `string`); update its import to `import type { CorridorId } from '../config/corridors'`.

- [ ] **Step 2: Pass corridors to the chips**

Both `<MapFilterChips ... />` instances (lines ~556 and ~609) need the new `corridors` prop:
```tsx
          corridors={corridorArtifact?.corridors ?? []}
```
Add that line to both instances alongside the existing `corridor={filters.corridor}` props.

- [ ] **Step 3: Typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: PASS. (Any LiveMap test that asserted SB corridor names will now reflect loaded data; if a test mocked corridors via stations, update it to provide a fetch mock for `corridors.json` or assert the no-corridor hidden state.)

- [ ] **Step 4: Commit**

```bash
git add src/web/routes/LiveMap.tsx
git commit -m "feat(web): LiveMap corridors from loaded artifact

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Remove the legacy module if now unused**

Run: `grep -rn "legacy-corridors" src/`
If only `scripts/generate-sb-corridors-override.ts` references it, leave it (the generator still needs it). If nothing in `src/` references it, that's expected — the generator under `scripts/` keeps it alive. Do NOT delete `legacy-corridors.ts`; it is the override generator's source of truth. Note this explicitly in the commit if you adjusted any leftover imports.

---

## Task F1: Branding from active-system metadata

**Files:**
- Modify: `src/web/components/BrandMark.tsx`
- Modify: `src/web/components/AboutModal.tsx`

Replace hardcoded "Santa Barbara"/bcycle strings with the active system's metadata (`useSystem().activeSystem`: `name`, `rentalUrl`, `gbfsUrl`).

- [ ] **Step 1: BrandMark subtitle**

In `src/web/components/BrandMark.tsx`, import the hook and replace the hardcoded subtitle (`Santa Barbara · Live`, line 58):
```tsx
import { useSystem } from '../context/SystemContext'
```
Inside `BrandMark()`:
```tsx
  const { activeSystem } = useSystem()
  const subtitle = activeSystem ? `${activeSystem.name} · Live` : 'Live'
```
Replace the `<Text>…Santa Barbara · Live</Text>` content with `{subtitle}`.

- [ ] **Step 2: AboutModal links + copy**

In `src/web/components/AboutModal.tsx`:
- Import `useSystem`.
- Move the `LINKS` array construction inside the component so it can reference the active system. Replace the two hardcoded bcycle URLs:
  - GBFS feed `href` → `activeSystem?.gbfsUrl ?? 'https://gbfs.bcycle.com/bcycle_santabarbara/gbfs.json'`
  - BCycle rental `href` → `activeSystem?.rentalUrl ?? 'https://santabarbara.bcycle.com'`
- Replace the `Santa Barbara, CA` label (line 105) with `{activeSystem?.name ?? 'Santa Barbara BCycle'}`.
- Replace the description (lines 112-113) `A live map of Santa Barbara's BCycle bike share…` with a system-neutral version:
  ```tsx
  A live map of {activeSystem?.name ?? 'this'} bike share, with historical patterns, a route planner, and a feed of recent activity. Find an available bike or an open dock before you walk over.
  ```
- Replace the footer `in Santa Barbara` (line 169) with `in {activeSystem?.name ?? 'Santa Barbara'}` (or simply drop the trailing location clause). Keep "Made by Sam Gutentag".

Concretely, inside `AboutModal({ open, onClose })`:
```tsx
  const { activeSystem } = useSystem()
  const LINKS: LinkCard[] = [
    { href: 'https://github.com/samgutentag/bcycle-map', label: 'GitHub', desc: 'View the code' },
    { href: activeSystem?.gbfsUrl ?? 'https://gbfs.bcycle.com/bcycle_santabarbara/gbfs.json', label: 'GBFS feed', desc: 'Live data origin' },
    { href: '/activity', label: 'Activity', desc: 'Recent rides', internal: true },
    { href: activeSystem?.rentalUrl ?? 'https://santabarbara.bcycle.com', label: 'BCycle', desc: 'Rent a real bike' },
    { href: 'mailto:bcycle-map@samgutentag.com', label: 'Contact', desc: 'Feedback & corrections' },
  ]
```
(Remove the module-level `const LINKS` declaration.)

- [ ] **Step 3: Typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: PASS. Components rendered without a provider use the `useSystem()` fallback (`activeSystem: null`), so the SB defaults render — existing snapshot/text expectations hold.

- [ ] **Step 4: Commit**

```bash
git add src/web/components/BrandMark.tsx src/web/components/AboutModal.tsx
git commit -m "feat(web): branding reads active-system metadata

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task G1: Seed RedBike Cincinnati + end-to-end verification

**Files:**
- Modify: `systems.json`

- [ ] **Step 1: Add the Cincinnati row**

```json
[
  {
    "system_id": "bcycle_santabarbara",
    "name": "Santa Barbara BCycle",
    "gbfs_url": "https://gbfs.bcycle.com/bcycle_santabarbara/gbfs.json",
    "version": "1.1"
  },
  {
    "system_id": "bcycle_cincyredbike",
    "name": "Red Bike - Cincinnati",
    "gbfs_url": "https://gbfs.bcycle.com/bcycle_cincyredbike/gbfs.json",
    "version": "1.1"
  }
]
```

- [ ] **Step 2: Tests + typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 3: Commit + push so workers pick up the new system**

```bash
git add systems.json
git commit -m "feat: seed RedBike Cincinnati network

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Let the pipelines run, then verify each artifact**

After merge to `main`:
1. The **poller** (cron every 5 min) will start writing `system:bcycle_cincyredbike:latest`. Confirm:
   ```bash
   curl -s https://bcycle-map-read-api.developer-95b.workers.dev/api/systems/bcycle_cincyredbike/current | head -c 200
   ```
   Expected: a JSON snapshot with Cincinnati stations (may take one cron cycle).
2. Trigger **corridors**:
   ```bash
   gh workflow run corridors.yml && gh run watch
   curl -s https://pub-83059e704dd64536a5166ab289eb42e5.r2.dev/gbfs/bcycle_cincyredbike/corridors.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['source'], len(d['corridors']), 'corridors')"
   ```
   Expected: `source` is `regions` (Cincinnati's stations carry `region_id`), with named neighborhood corridors (Avondale, Clifton, …).
3. Confirm the index lists both:
   ```bash
   curl -s https://bcycle-map-read-api.developer-95b.workers.dev/api/systems | python3 -c "import sys,json; d=json.load(sys.stdin); print([s['systemId'] for s in d['systems']], 'nearest=', d['nearestId'])"
   ```
   Expected: both system ids present.

- [ ] **Step 5: Manual UI verification**

Run: `npm run dev:web`, open the app.
- The header now shows the **NetworkPicker** (2 systems).
- Switch to Cincinnati: map re-fits to Cincinnati, pins load, corridor chip lists Cincinnati neighborhoods, About modal shows "Red Bike - Cincinnati" and the Cincinnati rental link.
- Switch back to SB: curated corridors (Funk Zone, State Street, …) still present.
- Reload: the last-picked network persists (localStorage).

- [ ] **Step 6: Final full suite**

Run: `npm test && npm run typecheck`
Expected: PASS.

---

## Self-review notes (addressed)

- **Spec coverage:** committed-override → GBFS-regions → directional fallback (A1-A3, B1-B2); server-side derivation as a compute script — refines the spec's "in the poller" to the repo's actual derived-artifact pattern (B2-B3); `/api/systems` edge-geo nearest (A4, C1); `SystemContext` resolver localStorage→geo→default (D2); picker (D3-D4); de-hardcode 6 routes (D5); map auto-fit (D6); branding from metadata (F1); seed-from-GBFS one-row add (G1); deferred `/<system>` URLs tracked in issue #99 (out of scope here).
- **Type consistency:** `CorridorArtifact`/`Corridor`/`CorridorOverride`/`CorridorStation`/`GbfsRegion` defined once in `src/shared/corridors.ts`; `SystemIndexEntry` once in `src/shared/systems-index.ts`; frontend `CorridorId = string`. `selectCorridors` return type matches what `compute-corridors` serializes and `useCorridors` parses.
- **Legacy module:** `src/web/config/corridors.ts` is split — old rules preserved as `legacy-corridors.ts` (override generator source), new artifact-driven API in `corridors.ts`.
