/**
 * Leaderboard rollup shape — separate file from popularity.ts so the
 * existing /route and /station-details pages (which depend on the pair-stat
 * map) keep working unchanged while /explore reads the new windowed shape.
 *
 * Written by scripts/compute-leaderboards.ts on a daily cron, read by
 * useLeaderboards on /explore. One rollup file holds both the 30-day
 * rolling window and the all-time window so the tab toggle is a free
 * lookup rather than a second fetch.
 */

export type LeaderboardStation = {
  station_id: string
  departures: number
  arrivals: number
  total: number
}

export type LeaderboardRoute = {
  from: string
  to: string
  trips: number
}

export type LeaderboardWindow = {
  stations: LeaderboardStation[]
  routes: LeaderboardRoute[]
}

export type Leaderboards = {
  /** Unix seconds, when the rollup was written. */
  generated_at: number
  windows: {
    '30d': LeaderboardWindow
    all: LeaderboardWindow
  }
}

/** Routes below this trip count are filtered from the leaderboard. */
export const ROUTE_MIN_TRIPS = 5

/** Each leaderboard list is capped at this many entries. */
export const LEADERBOARD_TOP_N = 20
