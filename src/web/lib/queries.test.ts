import { describe, it, expect } from 'vitest'
import {
  buildTotalBikesQuery,
  buildHourOfWeekQuery,
  buildStationSnapshotsQuery,
  daysCovered,
} from './queries'

const sampleUrls = [
  'https://r2.dev/gbfs/bcycle_santabarbara/station_status/dt=2026-05-13/12.parquet',
  'https://r2.dev/gbfs/bcycle_santabarbara/station_status/dt=2026-05-13/13.parquet',
]

describe('daysCovered', () => {
  it('returns one date for a same-day range', () => {
    const days = daysCovered(1778716800, 1778716800 + 100)
    expect(days.length).toBe(1)
    expect(days[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('returns each UTC date in the range', () => {
    const days = daysCovered(1778716800, 1778716800 + 2 * 86400 + 100)
    expect(days.length).toBe(3)
  })
})

describe('buildTotalBikesQuery', () => {
  it('aggregates by snapshot_ts and filters by the range', () => {
    const sql = buildTotalBikesQuery({
      range: { fromTs: 1778716800, toTs: 1778716800 + 100 },
      urls: sampleUrls,
    })
    expect(sql).toContain('SUM(num_bikes_available)')
    expect(sql).toContain('SUM(num_docks_available)')
    expect(sql).toContain('GROUP BY snapshot_ts')
    expect(sql).toContain('ORDER BY snapshot_ts')
    expect(sql).toContain('1778716800')
    expect(sql).toContain('dt=2026-05-13/12.parquet')
  })

  it('returns an empty result when no URLs are given', () => {
    const sql = buildTotalBikesQuery({
      range: { fromTs: 0, toTs: 1 },
      urls: [],
    })
    expect(sql).toContain('WHERE FALSE')
  })
})

describe('buildHourOfWeekQuery', () => {
  it('groups by dow and hod', () => {
    const sql = buildHourOfWeekQuery({
      range: { fromTs: 1778716800, toTs: 1778716800 + 7 * 86400 },
      urls: sampleUrls,
    })
    expect(sql).toContain("date_part('dow'")
    expect(sql).toContain("date_part('hour'")
    expect(sql).toContain('GROUP BY')
    expect(sql).toContain('AVG(num_bikes_available)')
  })

  it('returns an empty result when no URLs are given', () => {
    const sql = buildHourOfWeekQuery({
      range: { fromTs: 0, toTs: 1 },
      urls: [],
    })
    expect(sql).toContain('WHERE FALSE')
  })
})

describe('buildStationSnapshotsQuery', () => {
  it('selects the latest snapshot per station at a given moment', () => {
    const sql = buildStationSnapshotsQuery({
      urls: sampleUrls,
      atTs: 1778716800 + 3600,
    })
    expect(sql).toContain('station_id')
    expect(sql).toContain('lat')
    expect(sql).toContain('lon')
    expect(sql).toContain('num_bikes_available')
  })

  it('returns an empty result when no URLs are given', () => {
    const sql = buildStationSnapshotsQuery({
      urls: [],
      atTs: 1000,
    })
    expect(sql).toContain('WHERE FALSE')
  })
})
