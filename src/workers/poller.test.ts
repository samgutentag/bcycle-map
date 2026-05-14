import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pollOnce, writeSnapshotToKV, currentBufferKey } from './poller'
import type { SystemConfig } from '../shared/systems'
import type { KVNamespace, R2Bucket } from '@cloudflare/workers-types'

function makeKV(): KVNamespace {
  const store = new Map<string, string>()
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value) }),
    delete: vi.fn(async (key: string) => { store.delete(key) }),
    list: vi.fn(async () => ({ keys: [...store.keys()].map(name => ({ name })), list_complete: true, cursor: '' })),
  } as unknown as KVNamespace
}

// Minimal R2 mock: activity-log GET returns null (no prior log) and put is
// a no-op spy. Sufficient for the poller tests, which only care about KV
// state assertions.
function makeR2(): R2Bucket {
  return {
    get: vi.fn(async () => null),
    put: vi.fn(async () => undefined),
  } as unknown as R2Bucket
}

const discovery = JSON.parse(
  readFileSync(join(__dirname, '../shared/fixtures/gbfs-discovery.json'), 'utf8')
)
const stationInfo = JSON.parse(
  readFileSync(join(__dirname, '../shared/fixtures/station-information-v1.1.json'), 'utf8')
)
const stationStatus = JSON.parse(
  readFileSync(join(__dirname, '../shared/fixtures/station-status-v1.1.json'), 'utf8')
)
const systemInfo = JSON.parse(
  readFileSync(join(__dirname, '../shared/fixtures/system-information-v1.1.json'), 'utf8')
)

const sys: SystemConfig = {
  system_id: 'bcycle_santabarbara',
  name: 'Santa Barbara BCycle',
  gbfs_url: 'https://gbfs.bcycle.com/bcycle_santabarbara/gbfs.json',
  version: '1.1',
}

const makeFetch = (): typeof fetch =>
  vi.fn(async (input: URL | RequestInfo) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.endsWith('/gbfs.json'))
      return new Response(JSON.stringify(discovery), { status: 200 })
    if (url.endsWith('/station_information.json'))
      return new Response(JSON.stringify(stationInfo), { status: 200 })
    if (url.endsWith('/station_status.json'))
      return new Response(JSON.stringify(stationStatus), { status: 200 })
    if (url.endsWith('/system_information.json'))
      return new Response(JSON.stringify(systemInfo), { status: 200 })
    return new Response('404', { status: 404 })
  }) as unknown as typeof fetch

describe('pollOnce', () => {
  it('returns a KVValue with merged stations and system info', async () => {
    const fetchFn = makeFetch()
    const result = await pollOnce(sys, { fetchImpl: fetchFn, now: () => 1778692030 })
    expect(result.system.system_id).toBe('bcycle_santabarbara')
    expect(result.snapshot_ts).toBe(1778692030)
    expect(result.stations.length).toBe(stationInfo.data.stations.length)
    expect(result.stations[0]).toHaveProperty('lat')
    expect(result.stations[0]).toHaveProperty('num_bikes_available')
  })
})

describe('writeSnapshotToKV', () => {
  it('writes latest and appends to the current-hour buffer', async () => {
    const kv = makeKV()
    const r2 = makeR2()
    const snap = await pollOnce(sys, { fetchImpl: makeFetch(), now: () => 1778692030 })
    await writeSnapshotToKV(kv, r2, snap)
    const latest = await kv.get(`system:${snap.system.system_id}:latest`)
    expect(latest).not.toBeNull()
    expect(JSON.parse(latest!).snapshot_ts).toBe(1778692030)
    const bufKey = currentBufferKey(snap.system.system_id, snap.snapshot_ts)
    const buf = await kv.get(bufKey)
    expect(buf).not.toBeNull()
    const parsed = JSON.parse(buf!)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBe(1)
    expect(parsed[0].snapshot_ts).toBe(1778692030)
  })

  it('appends a second snapshot to the existing buffer for the same hour', async () => {
    const kv = makeKV()
    const r2 = makeR2()
    const snap1 = await pollOnce(sys, { fetchImpl: makeFetch(), now: () => 1778692030 })
    const snap2 = await pollOnce(sys, { fetchImpl: makeFetch(), now: () => 1778692150 })
    await writeSnapshotToKV(kv, r2, snap1)
    await writeSnapshotToKV(kv, r2, snap2)
    const bufKey = currentBufferKey(snap1.system.system_id, snap1.snapshot_ts)
    const buf = JSON.parse((await kv.get(bufKey))!)
    expect(buf.length).toBe(2)
  })
})

describe('currentBufferKey', () => {
  it('keys by system_id and UTC YYYY-MM-DD-HH', () => {
    const key = currentBufferKey('bcycle_santabarbara', 1778692030)
    expect(key).toMatch(/^system:bcycle_santabarbara:buffer:\d{4}-\d{2}-\d{2}-\d{2}$/)
  })
})
