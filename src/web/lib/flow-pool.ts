import type { Trip } from '@shared/types'

/**
 * Density-preserving trip scheduling for /flow playback.
 *
 * Compresses real departure timestamps into "pool seconds" so the
 * animation loops in ~targetLoopSec wall-clock seconds, but preserves
 * the relative timing between departures. Rush-hour bursts produce many
 * concurrent bikes; quiet stretches show fewer.
 *
 * After proportional compression, any gap between consecutive departures
 * exceeding `maxGapSec` is clamped down so the animation never stalls
 * in dead air. Density within clusters is preserved; only the dead time
 * between clusters gets squashed.
 */

const MIN_ANIM_SEC = 4
const MAX_ANIM_SEC = 12
const MAX_GAP_SEC = 3

export type PoolEntry = {
  trip: Trip
  poolStart: number
  poolEnd: number
}

export type PoolSchedule = {
  entries: PoolEntry[]
  totalDuration: number
}

function animDuration(trip: Trip): number {
  const raw = trip.duration_sec / 90
  if (raw < MIN_ANIM_SEC) return MIN_ANIM_SEC
  if (raw > MAX_ANIM_SEC) return MAX_ANIM_SEC
  return raw
}

export function schedulePool(trips: Trip[], targetLoopSec = 120): PoolSchedule {
  if (trips.length === 0) return { entries: [], totalDuration: 0 }

  const sorted = [...trips].sort((a, b) => a.departure_ts - b.departure_ts)
  const firstDep = sorted[0]!.departure_ts
  const lastDep = sorted[sorted.length - 1]!.departure_ts
  const realSpan = lastDep - firstDep

  const avgAnim = (MIN_ANIM_SEC + MAX_ANIM_SEC) / 2
  const departureSpread = Math.max(1, targetLoopSec - avgAnim)
  const ratio = realSpan > 0 ? departureSpread / realSpan : 1

  const entries: PoolEntry[] = []
  for (const trip of sorted) {
    const poolStart = (trip.departure_ts - firstDep) * ratio
    const dur = animDuration(trip)
    entries.push({ trip, poolStart, poolEnd: poolStart + dur })
  }

  // Compress gaps: walk through sorted entries and squash any
  // inter-departure gap exceeding MAX_GAP_SEC. Shifts all subsequent
  // entries back, preserving relative spacing within clusters.
  for (let i = 1; i < entries.length; i++) {
    const gap = entries[i]!.poolStart - entries[i - 1]!.poolStart
    if (gap > MAX_GAP_SEC) {
      const excess = gap - MAX_GAP_SEC
      for (let j = i; j < entries.length; j++) {
        entries[j]!.poolStart -= excess
        entries[j]!.poolEnd -= excess
      }
    }
  }

  let maxEnd = 0
  for (const e of entries) {
    if (e.poolEnd > maxEnd) maxEnd = e.poolEnd
  }

  return { entries, totalDuration: maxEnd }
}
