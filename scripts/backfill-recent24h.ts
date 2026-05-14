import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3'
import { parquetReadObjects } from 'hyparquet'

export type HourBikeStats = { hour_ts: number; bikes_min: number; bikes_max: number }

type ParquetRow = {
  snapshot_ts: bigint | number
  station_id: string
  num_bikes_available: number
  num_docks_available: number
}

/**
 * Build the 23 complete-hour partition keys preceding the current UTC hour.
 * The current in-progress hour is intentionally skipped — the poller will
 * own it from its next tick.
 */
export function partitionKeysFor24h(systemId: string, nowSec: number): Array<{ hourTs: number; key: string }> {
  const currentHourTs = Math.floor(nowSec / 3600) * 3600
  const out: Array<{ hourTs: number; key: string }> = []
  for (let i = 23; i >= 1; i--) {
    const hourTs = currentHourTs - i * 3600
    const d = new Date(hourTs * 1000)
    const yyyy = d.getUTCFullYear()
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(d.getUTCDate()).padStart(2, '0')
    const hh = String(d.getUTCHours()).padStart(2, '0')
    out.push({ hourTs, key: `gbfs/${systemId}/station_status/dt=${yyyy}-${mm}-${dd}/${hh}.parquet` })
  }
  return out
}

/**
 * Given a parquet file's rows, returns the hour's bikes_min/bikes_max,
 * derived from system-wide sum(num_bikes_available) per unique snapshot_ts.
 */
export function statsFromRows(rows: ParquetRow[]): { bikes_min: number; bikes_max: number } | null {
  const sumByTs = new Map<number, number>()
  for (const r of rows) {
    const ts = typeof r.snapshot_ts === 'bigint' ? Number(r.snapshot_ts) : r.snapshot_ts
    sumByTs.set(ts, (sumByTs.get(ts) ?? 0) + Number(r.num_bikes_available))
  }
  if (sumByTs.size === 0) return null
  let min = Infinity
  let max = -Infinity
  for (const v of sumByTs.values()) {
    if (v < min) min = v
    if (v > max) max = v
  }
  return { bikes_min: min, bikes_max: max }
}

/**
 * Read each partition (skipping 404s) and return the hour stats array.
 */
async function buildBackfillEntries(
  s3: S3Client,
  bucket: string,
  systemId: string,
  nowSec: number,
): Promise<HourBikeStats[]> {
  const partitions = partitionKeysFor24h(systemId, nowSec)
  const entries: HourBikeStats[] = []
  for (const { hourTs, key } of partitions) {
    try {
      const got = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      const ab = await got.Body!.transformToByteArray()
      const rows = await parquetReadObjects({
        file: ab.buffer as ArrayBuffer,
        columns: ['snapshot_ts', 'station_id', 'num_bikes_available', 'num_docks_available'],
      }) as ParquetRow[]
      const stats = statsFromRows(rows)
      if (stats) {
        entries.push({ hour_ts: hourTs, ...stats })
        console.log(`  ${key}: bikes_min=${stats.bikes_min} bikes_max=${stats.bikes_max}`)
      } else {
        console.log(`  ${key}: empty parquet, skipping`)
      }
    } catch (e: any) {
      if (e?.Code === 'NoSuchKey' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) {
        console.log(`  ${key}: not yet compacted, skipping`)
        continue
      }
      throw e
    }
  }
  return entries
}

type KVClient = {
  get(key: string): Promise<string | null>
  put(key: string, body: string): Promise<void>
}

function makeKVClient(opts: { accountId: string; namespaceId: string; token: string; fetchImpl?: typeof fetch }): KVClient {
  const fetchFn = opts.fetchImpl ?? fetch
  const base = `https://api.cloudflare.com/client/v4/accounts/${opts.accountId}/storage/kv/namespaces/${opts.namespaceId}`
  const headers = { authorization: `Bearer ${opts.token}` }
  return {
    get: async (key) => {
      const res = await fetchFn(`${base}/values/${encodeURIComponent(key)}`, { headers })
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`KV get ${res.status}`)
      return await res.text()
    },
    put: async (key, body) => {
      const res = await fetchFn(`${base}/values/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { ...headers, 'content-type': 'application/octet-stream' },
        body,
      })
      if (!res.ok) throw new Error(`KV put ${res.status}: ${await res.text()}`)
    },
  }
}

/**
 * Merge `entries` into the existing `recent24h` from KV: union by hour_ts
 * (existing takes precedence on overlap, so we never overwrite a poller-set
 * current-hour entry). Result is sorted and trimmed to 24h.
 */
export function mergeRecent24h(
  existing: HourBikeStats[],
  entries: HourBikeStats[],
  nowSec: number,
): HourBikeStats[] {
  const cutoff = nowSec - 24 * 3600
  const byHour = new Map<number, HourBikeStats>()
  for (const e of entries) byHour.set(e.hour_ts, e)
  for (const e of existing) byHour.set(e.hour_ts, e)  // existing wins
  return Array.from(byHour.values())
    .filter(e => e.hour_ts >= cutoff)
    .sort((a, b) => a.hour_ts - b.hour_ts)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = process.env
  for (const k of [
    'CF_ACCOUNT_ID',
    'CF_KV_API_TOKEN',
    'CF_KV_NAMESPACE_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET',
    'SYSTEM_ID',
  ]) {
    if (!env[k]) throw new Error(`missing env ${k}`)
  }

  ;(async () => {
    const systemId = env.SYSTEM_ID!
    const nowSec = Math.floor(Date.now() / 1000)

    const s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${env.CF_ACCOUNT_ID!}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY! },
    })
    const kv = makeKVClient({
      accountId: env.CF_ACCOUNT_ID!,
      namespaceId: env.CF_KV_NAMESPACE_ID!,
      token: env.CF_KV_API_TOKEN!,
    })

    console.log(`Backfilling recent24h for ${systemId} (now=${new Date(nowSec * 1000).toISOString()})`)
    console.log('Reading historical partitions:')
    const entries = await buildBackfillEntries(s3, env.R2_BUCKET!, systemId, nowSec)
    console.log(`Built ${entries.length} hour entries from R2.`)

    const latestKey = `system:${systemId}:latest`
    const raw = await kv.get(latestKey)
    if (!raw) throw new Error(`KV ${latestKey} not found — the poller may not have run yet`)
    const parsed = JSON.parse(raw)
    const existing: HourBikeStats[] = Array.isArray(parsed.recent24h) ? parsed.recent24h : []
    console.log(`Existing recent24h has ${existing.length} entries (will not be overwritten on overlap).`)

    const merged = mergeRecent24h(existing, entries, nowSec)
    console.log(`Merged total: ${merged.length} entries.`)

    parsed.recent24h = merged
    await kv.put(latestKey, JSON.stringify(parsed))
    console.log(`Wrote merged recent24h back to ${latestKey}.`)
  })().catch(err => {
    console.error('backfill failed:', err)
    process.exit(1)
  })
}
