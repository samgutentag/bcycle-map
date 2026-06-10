import systemsData from '../../systems.json'

export type SystemConfig = {
  system_id: string
  name: string
  gbfs_url: string
  version: string
  // Opt-out switch. Omitted or true = active; false = disabled. Disabling a
  // system removes it from the poll loop, the compute-* rollups, and the
  // picker's systems-index.json, dropping its Cloudflare KV/R2 ops to zero.
  // Already-collected data stays in R2/KV (frozen) and remains addressable
  // via getSystem(). Flip back to re-activate.
  enabled?: boolean
}

const systems = systemsData as SystemConfig[]

// Active systems only — anything explicitly disabled is filtered out so the
// poller and every downstream rollup skip it.
export function getSystems(): SystemConfig[] {
  return systems.filter(s => s.enabled !== false)
}

// Lookup by id across ALL configured systems, including disabled ones, so
// historical data for a paused system stays resolvable.
export function getSystem(systemId: string): SystemConfig | undefined {
  return systems.find(s => s.system_id === systemId)
}
