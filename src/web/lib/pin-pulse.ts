// Diff two live snapshots to figure out which stations had a bike-count change
// since the previous tick. Used by LiveMap to fire a brief radial pulse on the
// matching pins. Pure / side-effect free so it can be unit tested in isolation.

import type { StationSnapshot } from '@shared/types'

export type PulseDirection = 'in' | 'out' | 'neutral'

export type PulseEvent = {
  stationId: string
  direction: PulseDirection
}

/**
 * Compare two snapshots and return a pulse event for each station whose
 * num_bikes_available (or num_docks_available) shifted between them.
 *
 * Direction rules:
 *   - 'in'      bikes went up (an arrival)
 *   - 'out'     bikes went down (a departure)
 *   - 'neutral' both bikes and docks moved in opposing-but-consistent ways
 *               (rare data noise — e.g. a maintenance swap), or only docks
 *               changed without a clear direction.
 *
 * Stations missing from `prev` are treated as newly observed and skipped
 * (no diff baseline). Stations missing from `next` are also skipped — they
 * dropped off the system and there's no pin to pulse.
 */
export function diffSnapshots(
  prev: StationSnapshot[] | null | undefined,
  next: StationSnapshot[] | null | undefined,
): PulseEvent[] {
  if (!prev || !next || prev.length === 0 || next.length === 0) return []

  const prevById = new Map<string, StationSnapshot>()
  for (const s of prev) prevById.set(s.station_id, s)

  const events: PulseEvent[] = []
  for (const cur of next) {
    const before = prevById.get(cur.station_id)
    if (!before) continue
    const bikesDelta = cur.num_bikes_available - before.num_bikes_available
    const docksDelta = cur.num_docks_available - before.num_docks_available
    if (bikesDelta === 0 && docksDelta === 0) continue

    let direction: PulseDirection
    if (bikesDelta > 0) {
      // Bike arrived. If docks shifted in a non-mirrored way (e.g. capacity
      // changed, maintenance swap), the signal is mixed → neutral.
      direction = docksDelta === 0 || docksDelta === -bikesDelta ? 'in' : 'neutral'
    } else if (bikesDelta < 0) {
      direction = docksDelta === 0 || docksDelta === -bikesDelta ? 'out' : 'neutral'
    } else {
      // Bikes unchanged but docks moved — capacity-only delta. Ambiguous.
      direction = 'neutral'
    }
    events.push({ stationId: cur.station_id, direction })
  }
  return events
}
