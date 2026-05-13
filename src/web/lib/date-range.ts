export type Preset = '24h' | '7d' | '30d' | 'all'

export type Range = { fromTs: number; toTs: number }

// Project start ts — anchor for "all-time" globs.
// 2026-05-13 00:00 UTC. Bump if you back-fill earlier data.
export const PROJECT_START_TS = 1778630400

export function resolveRange(preset: Preset, nowTs: number): Range {
  switch (preset) {
    case '24h': return { fromTs: nowTs - 24 * 3600, toTs: nowTs }
    case '7d':  return { fromTs: nowTs - 7 * 86400, toTs: nowTs }
    case '30d': return { fromTs: nowTs - 30 * 86400, toTs: nowTs }
    case 'all': return { fromTs: PROJECT_START_TS, toTs: nowTs }
  }
}
