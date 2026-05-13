import { describe, it, expect } from 'vitest'
import { snapshotsToParquet, parquetToSnapshots } from './parquet'
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
