import { describe, it, expect } from 'vitest'
import {
  parseBufferKey,
  isFinishedHour,
  parquetKeyForBuffer,
  runCompaction,
} from './compact'

describe('parseBufferKey', () => {
  it('parses a valid key', () => {
    const r = parseBufferKey('system:bcycle_santabarbara:buffer:2026-05-13-14')
    expect(r).not.toBeNull()
    expect(r!.system_id).toBe('bcycle_santabarbara')
    expect(r!.hourTs).toBe(Math.floor(Date.UTC(2026, 4, 13, 14) / 1000))
  })

  it('rejects malformed keys', () => {
    expect(parseBufferKey('system:s:latest')).toBeNull()
    expect(parseBufferKey('foo')).toBeNull()
    expect(parseBufferKey('system:s:buffer:2026-5-13-14')).toBeNull()
  })
})

describe('isFinishedHour', () => {
  it('returns false for hour still in progress', () => {
    const hour = Math.floor(Date.UTC(2026, 4, 13, 14) / 1000)
    const now = hour + 1800 // mid-hour
    expect(isFinishedHour(hour, now)).toBe(false)
  })

  it('returns false in grace period after hour ends', () => {
    const hour = Math.floor(Date.UTC(2026, 4, 13, 14) / 1000)
    const now = hour + 3600 + 100 // 100s after hour end, within 300s grace
    expect(isFinishedHour(hour, now)).toBe(false)
  })

  it('returns true after grace period', () => {
    const hour = Math.floor(Date.UTC(2026, 4, 13, 14) / 1000)
    const now = hour + 3600 + 400 // 400s after hour end, past 300s grace
    expect(isFinishedHour(hour, now)).toBe(true)
  })
})

describe('parquetKeyForBuffer', () => {
  it('formats date-partitioned path', () => {
    const hourTs = Math.floor(Date.UTC(2026, 4, 13, 14) / 1000)
    expect(parquetKeyForBuffer('bcycle_santabarbara', hourTs)).toBe(
      'gbfs/bcycle_santabarbara/station_status/dt=2026-05-13/14.parquet'
    )
  })
})

describe('runCompaction', () => {
  it('compacts finished hours and skips in-progress', async () => {
    const prevHour = Math.floor(Date.UTC(2026, 4, 13, 13) / 1000)
    const currHour = Math.floor(Date.UTC(2026, 4, 13, 14) / 1000)
    const now = currHour + 1800

    const kvStore = new Map<string, string>([
      [
        'system:s:latest',
        JSON.stringify({
          system: { system_id: 's', name: 'S', timezone: 'UTC', language: 'en' },
          snapshot_ts: now,
          stations: [
            {
              station_id: 'a',
              name: 'A',
              lat: 0,
              lon: 0,
              num_bikes_available: 1,
              num_docks_available: 1,
              bikes_electric: 1,
              bikes_classic: 0,
              bikes_smart: 0,
              is_installed: true,
              is_renting: true,
              is_returning: true,
              last_reported: now,
            },
          ],
        }),
      ],
      [
        `system:s:buffer:2026-05-13-13`,
        JSON.stringify([
          {
            snapshot_ts: prevHour + 120,
            stations: [
              {
                station_id: 'a',
                num_bikes_available: 1,
                num_docks_available: 1,
                bikes_electric: 1,
                bikes_classic: 0,
                bikes_smart: 0,
                is_installed: true,
                is_renting: true,
                is_returning: true,
                last_reported: prevHour + 120,
              },
            ],
          },
        ]),
      ],
      [
        `system:s:buffer:2026-05-13-14`,
        JSON.stringify([
          {
            snapshot_ts: currHour + 120,
            stations: [
              {
                station_id: 'a',
                num_bikes_available: 0,
                num_docks_available: 2,
                bikes_electric: 0,
                bikes_classic: 0,
                bikes_smart: 0,
                is_installed: true,
                is_renting: true,
                is_returning: true,
                last_reported: currHour + 120,
              },
            ],
          },
        ]),
      ],
    ])

    const kvDeleted: string[] = []
    const r2Puts: Array<{ key: string; bytes: number }> = []

    const result = await runCompaction({
      now: () => now,
      kv: {
        list: async (prefix) =>
          [...kvStore.keys()].filter((k) => k.startsWith(prefix)),
        get: async (key) => kvStore.get(key) ?? null,
        delete: async (key) => {
          kvStore.delete(key)
          kvDeleted.push(key)
        },
      },
      r2: {
        put: async (key, bytes) => {
          r2Puts.push({ key, bytes: bytes.byteLength })
        },
      },
    })

    expect(result.compacted).toBe(1)
    expect(result.skipped).toBe(1)
    expect(r2Puts.length).toBe(1)
    expect(r2Puts[0]!.key).toBe('gbfs/s/station_status/dt=2026-05-13/13.parquet')
    expect(r2Puts[0]!.bytes).toBeGreaterThan(0)
    expect(kvDeleted).toEqual(['system:s:buffer:2026-05-13-13'])
  })
})
