import { describe, it, expect } from 'vitest'
import { snapshotsToParquet, parquetToSnapshots, parquetPartitionKey, partitionKeysForRange } from './parquet'
import { StationSnapshot } from './types'

const sample: StationSnapshot = {
  station_id: 'bcycle_santabarbara_4852',
  name: 'West Cota & State',
  lat: 34.4179,
  lon: -119.69708,
  address: '601 State St.',
  num_bikes_available: 3,
  num_docks_available: 7,
  bikes_electric: 3,
  bikes_classic: 0,
  bikes_smart: 0,
  is_installed: true,
  is_renting: true,
  is_returning: true,
  last_reported: 1778692030,
}

describe('snapshotsToParquet', () => {
  it('round-trips a single-row snapshot batch', async () => {
    const buf = await snapshotsToParquet([{ snapshot_ts: 1778692030, station: sample }])
    expect(buf.byteLength).toBeGreaterThan(0)
    const back = await parquetToSnapshots(buf)
    expect(back.length).toBe(1)
    expect(back[0]!.station.station_id).toBe(sample.station_id)
    expect(back[0]!.station.num_bikes_available).toBe(3)
  })

  it('round-trips many rows', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      snapshot_ts: 1778692030 + i * 60,
      station: { ...sample, num_bikes_available: i % 10 },
    }))
    const buf = await snapshotsToParquet(rows)
    const back = await parquetToSnapshots(buf)
    expect(back.length).toBe(100)
    expect(back[99]!.station.num_bikes_available).toBe(9)
  })

  it('preserves boolean fields through round-trip', async () => {
    const trueRow = { ...sample, is_installed: true, is_renting: true, is_returning: true }
    const falseRow = {
      ...sample,
      station_id: 'x_off',
      is_installed: false,
      is_renting: false,
      is_returning: true,
    }
    const buf = await snapshotsToParquet([
      { snapshot_ts: 1, station: trueRow },
      { snapshot_ts: 2, station: falseRow },
    ])
    const back = await parquetToSnapshots(buf)
    expect(back[0]!.station.is_installed).toBe(true)
    expect(back[0]!.station.is_renting).toBe(true)
    expect(back[1]!.station.is_installed).toBe(false)
    expect(back[1]!.station.is_renting).toBe(false)
    expect(back[1]!.station.is_returning).toBe(true)
  })
})

describe('parquetPartitionKey', () => {
  it('formats a single hourly R2 key from a unix-epoch hour timestamp', () => {
    // 2026-05-14 09:00 UTC
    const hourTs = Math.floor(Date.UTC(2026, 4, 14, 9) / 1000)
    expect(parquetPartitionKey('bcycle_x', hourTs)).toBe(
      'gbfs/bcycle_x/station_status/dt=2026-05-14/09.parquet',
    )
  })

  it('zero-pads single-digit months, days, and hours', () => {
    // 2026-01-02 03:00 UTC
    const hourTs = Math.floor(Date.UTC(2026, 0, 2, 3) / 1000)
    expect(parquetPartitionKey('bcycle_x', hourTs)).toBe(
      'gbfs/bcycle_x/station_status/dt=2026-01-02/03.parquet',
    )
  })

  it('handles midnight correctly', () => {
    const hourTs = Math.floor(Date.UTC(2026, 11, 31, 0) / 1000)
    expect(parquetPartitionKey('sys', hourTs)).toBe(
      'gbfs/sys/station_status/dt=2026-12-31/00.parquet',
    )
  })
})

describe('partitionKeysForRange', () => {
  it('emits one key per hour spanning the window (with 1h pad on each side)', () => {
    const since = Math.floor(Date.UTC(2026, 4, 13, 12) / 1000)
    const until = since + 2 * 3600 // 14:00 UTC
    const keys = partitionKeysForRange('bcycle_sb', since, until)
    // Pad of 1h before/after means we cover 11..15 UTC inclusive (5 keys)
    expect(keys).toHaveLength(5)
    expect(keys[0]).toBe('gbfs/bcycle_sb/station_status/dt=2026-05-13/11.parquet')
    expect(keys[4]).toBe('gbfs/bcycle_sb/station_status/dt=2026-05-13/15.parquet')
  })

  it('crosses date boundaries', () => {
    const since = Math.floor(Date.UTC(2026, 4, 13, 23, 30) / 1000)
    const until = since + 2 * 3600
    const keys = partitionKeysForRange('bcycle_sb', since, until)
    expect(keys.some(k => k.endsWith('dt=2026-05-13/23.parquet'))).toBe(true)
    expect(keys.some(k => k.endsWith('dt=2026-05-14/01.parquet'))).toBe(true)
  })

  it('returns a single key when sinceTs and untilTs fall in the same hour', () => {
    const ts = Math.floor(Date.UTC(2026, 4, 13, 12, 15) / 1000)
    const keys = partitionKeysForRange('bcycle_sb', ts, ts)
    // 1h pad each side: hours 11, 12, 13
    expect(keys).toHaveLength(3)
  })
})
