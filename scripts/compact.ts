import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { snapshotsToParquet } from '../src/shared/parquet'
import type { BufferEntry, KVValue, StationSnapshot } from '../src/shared/types'

// returns { system_id, hourTs } where hourTs is the unix epoch ts of the start of that UTC hour
export function parseBufferKey(key: string): { system_id: string; hourTs: number } | null {
  const m = key.match(/^system:([^:]+):buffer:(\d{4})-(\d{2})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const [, system_id, y, mo, d, h] = m
  const hourTs = Math.floor(Date.UTC(+y!, +mo! - 1, +d!, +h!) / 1000)
  return { system_id: system_id!, hourTs }
}

// "finished" = the hour ended and the grace period has elapsed, so we won't race
// with a still-writing buffer.
export function isFinishedHour(hourTs: number, nowTs: number, graceSec = 300): boolean {
  return hourTs + 3600 + graceSec <= nowTs
}

// parquet R2 key for a given buffer (UTC date partitioning)
export function parquetKeyForBuffer(systemId: string, hourTs: number): string {
  const d = new Date(hourTs * 1000)
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  return `gbfs/${systemId}/station_status/dt=${yyyy}-${mm}-${dd}/${hh}.parquet`
}

export type KVClient = {
  list: (prefix: string) => Promise<string[]>
  get: (key: string) => Promise<string | null>
  delete: (key: string) => Promise<void>
}

export type R2Client = {
  put: (key: string, body: Uint8Array) => Promise<void>
}

type KVListResponse = {
  result: { name: string }[]
  result_info?: { cursor?: string }
}

export function makeKVClient(opts: {
  accountId: string
  namespaceId: string
  token: string
  fetchImpl?: typeof fetch
}): KVClient {
  const fetchFn = opts.fetchImpl ?? fetch
  const base = `https://api.cloudflare.com/client/v4/accounts/${opts.accountId}/storage/kv/namespaces/${opts.namespaceId}`
  const headers = { authorization: `Bearer ${opts.token}` }
  return {
    list: async (prefix) => {
      const keys: string[] = []
      let cursor: string | undefined
      do {
        const url = `${base}/keys?prefix=${encodeURIComponent(prefix)}${cursor ? `&cursor=${cursor}` : ''}`
        const res = await fetchFn(url, { headers })
        if (!res.ok) throw new Error(`KV list ${res.status}`)
        const body = (await res.json()) as KVListResponse
        keys.push(...body.result.map((r) => r.name))
        cursor = body.result_info?.cursor || undefined
      } while (cursor)
      return keys
    },
    get: async (key) => {
      const res = await fetchFn(`${base}/values/${encodeURIComponent(key)}`, { headers })
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`KV get ${res.status}`)
      return await res.text()
    },
    delete: async (key) => {
      const res = await fetchFn(`${base}/values/${encodeURIComponent(key)}`, {
        method: 'DELETE',
        headers,
      })
      if (!res.ok && res.status !== 404) throw new Error(`KV delete ${res.status}`)
    },
  }
}

export function makeR2Client(opts: {
  accountId: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}): R2Client {
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${opts.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: opts.accessKeyId,
      secretAccessKey: opts.secretAccessKey,
    },
  })
  return {
    put: async (key, body) => {
      await s3.send(
        new PutObjectCommand({
          Bucket: opts.bucket,
          Key: key,
          Body: body,
          ContentType: 'application/octet-stream',
        })
      )
    },
  }
}

export async function runCompaction(deps: {
  kv: KVClient
  r2: R2Client
  now?: () => number
}): Promise<{ compacted: number; skipped: number }> {
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000))
  const allKeys = await deps.kv.list('system:')
  const bufferKeys = allKeys
    .map((k) => ({ key: k, parsed: parseBufferKey(k) }))
    .filter(
      (x): x is { key: string; parsed: { system_id: string; hourTs: number } } =>
        x.parsed !== null
    )

  let compacted = 0
  let skipped = 0

  for (const { key, parsed } of bufferKeys) {
    if (!isFinishedHour(parsed.hourTs, now())) {
      skipped++
      continue
    }

    const latestKey = `system:${parsed.system_id}:latest`
    const [bufRaw, latestRaw] = await Promise.all([
      deps.kv.get(key),
      deps.kv.get(latestKey),
    ])
    if (!bufRaw) {
      skipped++
      continue
    }

    const buffer: BufferEntry[] = JSON.parse(bufRaw)
    const latest: KVValue | null = latestRaw ? JSON.parse(latestRaw) : null
    const staticById = new Map(
      latest?.stations.map((s) => [
        s.station_id,
        { name: s.name, lat: s.lat, lon: s.lon, address: s.address },
      ]) ?? []
    )

    const rows = buffer.flatMap((entry) =>
      entry.stations.map((d) => {
        const stat = staticById.get(d.station_id) ?? {
          name: '',
          lat: 0,
          lon: 0,
          address: undefined as string | undefined,
        }
        return {
          snapshot_ts: entry.snapshot_ts,
          station: { ...stat, ...d } as StationSnapshot,
        }
      })
    )

    if (rows.length === 0) {
      skipped++
      continue
    }

    const parquetBytes = await snapshotsToParquet(rows)
    await deps.r2.put(parquetKeyForBuffer(parsed.system_id, parsed.hourTs), parquetBytes)
    await deps.kv.delete(key)
    compacted++
  }

  return { compacted, skipped }
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const env = process.env
  for (const k of [
    'CF_ACCOUNT_ID',
    'CF_KV_API_TOKEN',
    'CF_KV_NAMESPACE_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET',
  ]) {
    if (!env[k]) throw new Error(`missing env ${k}`)
  }
  const kv = makeKVClient({
    accountId: env.CF_ACCOUNT_ID!,
    namespaceId: env.CF_KV_NAMESPACE_ID!,
    token: env.CF_KV_API_TOKEN!,
  })
  const r2 = makeR2Client({
    accountId: env.CF_ACCOUNT_ID!,
    bucket: env.R2_BUCKET!,
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
  })
  runCompaction({ kv, r2 }).then(
    (r) => {
      console.log(`compacted: ${r.compacted}, skipped: ${r.skipped}`)
    },
    (e) => {
      console.error('compaction failed:', e)
      process.exit(1)
    }
  )
}
