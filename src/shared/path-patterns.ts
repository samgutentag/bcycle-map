/**
 * Collapse high-cardinality paths into route patterns so the insights page
 * can aggregate (e.g. /station/4852/details and /station/4863/details both
 * become /station/:id/details).
 *
 * Order matters — most-specific patterns first.
 */
type Pattern = { match: RegExp; label: string; display: string }

const PATTERNS: Pattern[] = [
  { match: /^\/station\/[^/]+\/details\/?$/, label: '/station/:id/details', display: 'Station details' },
  { match: /^\/station\/[^/]+\/?$/, label: '/station/:id', display: 'Station (map focus)' },
  { match: /^\/route\/[^/]+\/[^/]+\/?$/, label: '/route/:from/:to', display: 'Route planner' },
  { match: /^\/route\/[^/]+\/?$/, label: '/route/:from', display: 'Route planner' },
  { match: /^\/route\/?$/, label: '/route', display: 'Route planner' },
  { match: /^\/flow\/?$/, label: '/flow', display: 'Flow' },
  { match: /^\/explore\/?$/, label: '/explore', display: 'Explore' },
  { match: /^\/activity\/?$/, label: '/activity', display: 'Activity' },
  { match: /^\/insights\/?$/, label: '/insights', display: 'Insights' },
  { match: /^\/$/, label: '/', display: 'Live map' },
]

function cleanPath(path: string): string {
  return path.split('?')[0]!.split('#')[0]!
}

export function normalizePath(path: string): string {
  const cleaned = cleanPath(path)
  for (const p of PATTERNS) {
    if (p.match.test(cleaned)) return p.label
  }
  return '(other)'
}

/**
 * Human-friendly page name for the insights "Top pages" table. Falls back to
 * the normalized pattern label for anything unmatched, so a new route shows
 * something recognizable rather than "(other)" until a pattern is added.
 */
export function displayNameForPath(path: string): string {
  const cleaned = cleanPath(path)
  for (const p of PATTERNS) {
    if (p.match.test(cleaned)) return p.display
  }
  return normalizePath(cleaned)
}
