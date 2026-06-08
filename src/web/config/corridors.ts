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
