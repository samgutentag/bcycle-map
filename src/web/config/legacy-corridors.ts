import type { StationSnapshot } from '@shared/types'

/**
 * Named geographic corridors used by the `/live` chip filter.
 *
 * v1 buckets the current ~97 Santa Barbara BCycle stations into 11 named
 * corridors based on name patterns + lat/lon. The assignment is rule-based
 * (not a static id → corridor map) so new stations get categorized
 * automatically as BCycle expands the system.
 *
 * Corridor boundaries are provisional and subject to local feedback — see
 * issue #50 and the map at `docs/corridor-map.html` for the visual review.
 *
 * To add a corridor: append to `CORRIDOR_ORDER` + `CORRIDOR_LABELS` and add
 * the matching predicate to `assignCorridor`.
 */

export type CorridorId =
  | 'waterfront'
  | 'cabrillo'
  | 'state_street'
  | 'de_la_vina'
  | 'funk_zone'
  | 'eastside'
  | 'mesa'
  | 'upper_east'
  | 'upper_state'
  | 'montecito'
  | 'downtown'

/** Render order for the dropdown. */
export const CORRIDOR_ORDER: readonly CorridorId[] = [
  'waterfront',
  'cabrillo',
  'state_street',
  'downtown',
  'de_la_vina',
  'funk_zone',
  'eastside',
  'mesa',
  'upper_east',
  'upper_state',
  'montecito',
] as const

export const CORRIDOR_LABELS: Record<CorridorId, string> = {
  waterfront:   'Waterfront',
  cabrillo:     'Cabrillo',
  state_street: 'State Street',
  downtown:     'Downtown core',
  de_la_vina:   'De La Vina',
  funk_zone:    'Funk Zone',
  eastside:     'Eastside (Milpas)',
  mesa:         'Mesa / Westside',
  upper_east:   'Upper East / Mission',
  upper_state:  'Upper State (La Cumbre)',
  montecito:    'Montecito',
}

/**
 * Assign a station to its corridor. Returns `null` if no rule matches —
 * those stations won't surface in any corridor filter but render normally
 * when no corridor is selected.
 *
 * Rules are evaluated top-to-bottom; the first match wins. Keep the
 * specific-to-general ordering: an explicit "X" match should come before
 * a broad lat-bound fallback.
 */
export function assignCorridor(s: Pick<StationSnapshot, 'name' | 'lat' | 'lon'>): CorridorId | null {
  const name = s.name.toLowerCase()
  const { lat, lon } = s

  // Montecito (far east)
  if (name.includes('coast village') || name.includes('montecito & soledad') || name.includes('old coast highway')) {
    return 'montecito'
  }

  // Upper State (far north, La Cumbre area)
  if (lat >= 34.440) return 'upper_state'
  if (name.includes('la cumbre') || name.includes('hope ave') || name.includes('s. ontare') || name.includes('s ontare')) {
    return 'upper_state'
  }

  // Waterfront (south of city, harbor/beach)
  if (name.includes('harbor') || name.includes('leadbetter') || name.includes('sailing') || name.includes('elise')) {
    return 'waterfront'
  }
  if (name.includes('cliff and') || name.includes('cliff &')) return 'waterfront'
  if (name.includes('sbcc @ cliff') || name.includes('sbcc motorcycle')) return 'waterfront'

  // Cabrillo (the beachfront avenue)
  if (name.includes('cabrillo') && (name.includes('mountainside') || name.includes('oceanside'))) return 'cabrillo'
  if (name.startsWith('cabrillo')) return 'cabrillo'
  if (name.includes('and cabrillo') || name.includes('& cabrillo')) return 'cabrillo'
  if (name.includes('amtrak')) return 'cabrillo'

  // Funk Zone (south of US-101, east of State, around Amtrak)
  if (name.includes('gutierrez') && name.includes('cesar chavez')) return 'funk_zone'
  if (name.includes('smart & final') || name.includes('third window') || name.includes('arts market')) return 'funk_zone'
  if (name.includes('gutierrez & chapala')) return 'funk_zone'
  if (name.includes('anacapa and e montecito')) return 'funk_zone'

  // Eastside / Milpas
  if (name.includes('milpas')) return 'eastside'
  if (name.includes('eastside library')) return 'eastside'
  if (name.includes('ensenada') || name.includes('e montecito & n alisos')) return 'eastside'
  if (name.includes('e cota and n salsipuedes')) return 'eastside'

  // Mesa / Westside
  if (name.includes('san andres') || name.includes('chino') || name.includes('harding')) return 'mesa'
  if (name.includes('castillo gardens') || name.includes('castillo and islay')) return 'mesa'
  if (name.includes('boys & girls club') || name.includes('san pascual')) return 'mesa'
  if (name.includes('sbcc schott')) return 'mesa'
  if (name.includes('victoria and euclid')) return 'mesa'
  if (name.includes('las positas')) return 'mesa'

  // De La Vina (parallel commercial strip, west of State)
  if (name.includes('de la vina') && !name.includes('state')) return 'de_la_vina'

  // State Street (downtown spine — anything with State in the cross-street name).
  // Evaluated BEFORE upper_east so stations like "State & Valerio St" go to the
  // spine instead of being captured by the upper_east 'valerio' rule.
  if (name.includes('& state') || name.includes('state &') || name.includes('state street') || name.includes('state st') || name.includes('mtd transit')) {
    return 'state_street'
  }

  // Upper East / Mission area
  if (name.includes('mission') || name.includes('natural history')) return 'upper_east'
  if (name.includes('chapala & arrellaga')) return 'upper_east'
  if (lat >= 34.428) {
    if (name.includes('bath') || name.includes('pueblo') || name.includes('castillo & los olivos')) return 'upper_east'
    if (name.includes('fran apartments') || name.includes('valerio') || name.includes('pedregosa')) return 'upper_east'
    if (name.includes('sola and santa barbara') || name.includes('anapamu and santa barbara')) return 'upper_east'
    if (name.includes('canon perdido & olive')) return 'upper_east'
    if (name.includes('garden & canon perdido')) return 'upper_east'
    if (name.includes('e los olivos and laguna')) return 'upper_east'
  }

  // Downtown core (the central grid that didn't match a more specific rule)
  if (lat >= 34.416 && lat <= 34.430 && lon >= -119.710 && lon <= -119.688) {
    return 'downtown'
  }

  return null
}

/**
 * Build a Map<station_id, CorridorId> from the live snapshot's stations.
 * Memoize this at the caller — it iterates every station.
 */
export function buildCorridorMap(stations: StationSnapshot[]): Map<string, CorridorId> {
  const m = new Map<string, CorridorId>()
  for (const s of stations) {
    const c = assignCorridor(s)
    if (c !== null) m.set(s.station_id, c)
  }
  return m
}

export function isCorridorId(value: string): value is CorridorId {
  return (CORRIDOR_ORDER as readonly string[]).includes(value)
}
