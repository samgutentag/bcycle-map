import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { parquetReadObjects } from 'hyparquet'

type ParquetRow = {
  snapshot_ts: bigint | number
  station_id: string
}

type KVClient = {
  get(key: string): Promise<string | null>
  put(key: string, body: string): Promise<void>
}

function makeKVClient(opts: { accountId: string; namespaceId: string; token: string }): KVClient {
  const base = `https://api.cloudflare.com/client/v4/accounts/${opts.accountId}/storage/kv/namespaces/${opts.namespaceId}`
  const headers = { authorization: `Bearer ${opts.token}` }
  return {
    get: async (key) => {
      const res = await fetch(`${base}/values/${encodeURIComponent(key)}`, { headers })
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`KV get ${res.status}`)
      return await res.text()
    },
    put: async (key, body) => {
      const res = await fetch(`${base}/values/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { ...headers, 'content-type': 'application/octet-stream' },
        body,
      })
      if (!res.ok) throw new Error(`KV put ${res.status}: ${await res.text()}`)
    },
  }
}

/**
 * Scan R2 to find the earliest parquet partition, read its station IDs,
 * and return the set of "original" station IDs along with the earliest
 * snapshot timestamp found.
 */
async function findOriginalStations(
  s3: S3Client,
  bucket: string,
  systemId: string,
): Promise<{ stationIds: Set<string>; earliestTs: number }> {
  const prefix = `gbfs/${systemId}/station_status/`

  const list = await s3.send(new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: prefix,
    MaxKeys: 5,
  }))

  if (!list.Contents || list.Contents.length === 0) {
    throw new Error(`No parquet files found under ${prefix}`)
  }

  const earliest = list.Contents.sort((a, b) => (a.Key ?? '').localeCompare(b.Key ?? ''))[0]!
  console.log(`Earliest partition: ${earliest.Key}`)

  const got = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: earliest.Key }))
  const ab = await got.Body!.transformToByteArray()
  const rows = await parquetReadObjects({
    file: ab.buffer as ArrayBuffer,
    columns: ['snapshot_ts', 'station_id'],
  }) as ParquetRow[]

  const stationIds = new Set<string>()
  let minTs = Infinity
  for (const r of rows) {
    stationIds.add(r.station_id)
    const ts = typeof r.snapshot_ts === 'bigint' ? Number(r.snapshot_ts) : r.snapshot_ts
    if (ts < minTs) minTs = ts
  }

  console.log(`Found ${stationIds.size} stations in earliest partition (ts=${new Date(minTs * 1000).toISOString()})`)
  return { stationIds, earliestTs: minTs }
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

    console.log(`Backfilling first_seen_ts for ${systemId}`)
    const { stationIds: originalIds, earliestTs } = await findOriginalStations(s3, env.R2_BUCKET!, systemId)

    const latestKey = `system:${systemId}:latest`
    const raw = await kv.get(latestKey)
    if (!raw) throw new Error(`KV ${latestKey} not found`)
    const parsed = JSON.parse(raw)

    // Set original stations to a date well outside the 14-day "new" window.
    // Using 30 days before the earliest partition ensures they never show
    // as new, even if the archive is recent.
    const backdateTo = earliestTs - 30 * 86400
    let backdated = 0
    let kept = 0
    for (const s of parsed.stations) {
      if (originalIds.has(s.station_id)) {
        s.first_seen_ts = backdateTo
        backdated++
      } else {
        kept++
      }
    }

    console.log(`Backdated ${backdated} original stations to ${new Date(backdateTo * 1000).toISOString()}`)
    console.log(`Kept ${kept} stations with current first_seen_ts (genuinely new)`)

    await kv.put(latestKey, JSON.stringify(parsed))
    console.log(`Wrote patched snapshot to ${latestKey}`)
  })().catch(err => {
    console.error('backfill failed:', err)
    process.exit(1)
  })
}
