import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pollOnce } from './poller'
import type { SystemConfig } from '../shared/systems'

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
