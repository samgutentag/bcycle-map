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
