/**
 * Collapse high-cardinality paths into route patterns so the insights page
 * can aggregate (e.g. /station/4852/details and /station/4863/details both
 * become /station/:id/details).
 *
 * Order matters — most-specific patterns first.
 */
type Pattern = { match: RegExp; label: string }

const PATTERNS: Pattern[] = [
  { match: /^\/station\/[^/]+\/details\/?$/, label: '/station/:id/details' },
  { match: /^\/station\/[^/]+\/?$/, label: '/station/:id' },
  { match: /^\/route\/[^/]+\/[^/]+\/?$/, label: '/route/:from/:to' },
  { match: /^\/route\/[^/]+\/?$/, label: '/route/:from' },
  { match: /^\/route\/?$/, label: '/route' },
  { match: /^\/explore\/?$/, label: '/explore' },
  { match: /^\/activity\/?$/, label: '/activity' },
  { match: /^\/insights\/?$/, label: '/insights' },
  { match: /^\/$/, label: '/' },
]

export function normalizePath(path: string): string {
  const cleaned = path.split('?')[0]!.split('#')[0]!
  for (const p of PATTERNS) {
    if (p.match.test(cleaned)) return p.label
  }
  return '(other)'
}
