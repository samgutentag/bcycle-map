import type { BeaconEvent } from '../hooks/useInsights'
import { displayNameForPath } from '@shared/path-patterns'

// Pure aggregation helpers for the /insights page. Kept out of the component
// so they're unit-testable and the page stays presentational. `now` is
// injectable on the time-bucketed helpers for deterministic tests.

export function filterToWindow(events: BeaconEvent[], windowDays: number, nowSec = Math.floor(Date.now() / 1000)): BeaconEvent[] {
  const cutoff = nowSec - windowDays * 86400
  return events.filter(e => e.ts >= cutoff)
}

export function pageviews(events: BeaconEvent[]): BeaconEvent[] {
  return events.filter(e => e.type !== 'event')
}

export function interactions(events: BeaconEvent[]): BeaconEvent[] {
  return events.filter(e => e.type === 'event')
}

export function countTop(
  events: BeaconEvent[],
  key: (e: BeaconEvent) => string | null,
  n: number,
): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const e of events) {
    const k = key(e) ?? '(none)'
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return Array.from(counts.entries()).sort(([, a], [, b]) => b - a).slice(0, n)
}

/** Top pages by friendly name, from pageview beacons only. */
export function topPages(events: BeaconEvent[], n: number): Array<[string, number]> {
  return countTop(pageviews(events), e => displayNameForPath(e.path), n)
}

/** Top from→to pairs from route_check_run events, using human names when present. */
export function topRoutePairs(events: BeaconEvent[], n: number): Array<[string, number]> {
  const runs = interactions(events).filter(e => e.name === 'route_check_run')
  return countTop(runs, e => {
    const from = e.props?.fromName || e.props?.from || '?'
    const to = e.props?.toName || e.props?.to || '?'
    return `${from} → ${to}`
  }, n)
}

/** Top stations from station_opened events, by name (falling back to id). */
export function topStations(events: BeaconEvent[], n: number): Array<[string, number]> {
  const opens = interactions(events).filter(e => e.name === 'station_opened')
  return countTop(opens, e => e.props?.stationName || e.props?.stationId || '(unknown)', n)
}

/** Counts of every interaction event by name. */
export function topActions(events: BeaconEvent[], n: number): Array<[string, number]> {
  return countTop(interactions(events), e => e.name ?? '(unknown)', n)
}

export function bucketByHour(events: BeaconEvent[], hours: number, nowSec = Math.floor(Date.now() / 1000)): number[] {
  const bucketStart = (Math.floor(nowSec / 3600) - hours + 1) * 3600
  const buckets = new Array(hours).fill(0)
  for (const e of events) {
    const idx = Math.floor((e.ts - bucketStart) / 3600)
    if (idx >= 0 && idx < hours) buckets[idx] += 1
  }
  return buckets
}

export function bucketByDay(events: BeaconEvent[], days: number, nowMs = Date.now()): number[] {
  const nowDayStart = Math.floor(nowMs / 86400_000) * 86400
  const bucketStart = nowDayStart - (days - 1) * 86400
  const buckets = new Array(days).fill(0)
  for (const e of events) {
    const idx = Math.floor((e.ts - bucketStart) / 86400)
    if (idx >= 0 && idx < days) buckets[idx] += 1
  }
  return buckets
}
