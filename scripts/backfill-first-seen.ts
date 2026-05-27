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
 * Scan ALL parquet partitions and find the earliest snapshot_ts for each
 * station_id. This gives the actual first-seen date, not an approximation.
 */
async function findEarliestPerStation(
  s3: S3Client,
  bucket: string,
  systemId: string,
): Promise<Map<string, number>> {
  const prefix = `gbfs/${systemId}/station_status/`
  const earliest = new Map<string, number>()

  let continuationToken: string | undefined
  let totalPartitions = 0

  do {
    const list = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: 1000,
      ContinuationToken: continuationToken,
    }))

    const keys = (list.Contents ?? [])
      .filter(o => o.Key)
      .sort((a, b) => a.Key!.localeCompare(b.Key!))

    for (const obj of keys) {
      try {
        const got = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: obj.Key }))
        const ab = await got.Body!.transformToByteArray()
        const rows = await parquetReadObjects({
          file: ab.buffer as ArrayBuffer,
          columns: ['snapshot_ts', 'station_id'],
        }) as ParquetRow[]

        for (const r of rows) {
          const ts = typeof r.snapshot_ts === 'bigint' ? Number(r.snapshot_ts) : r.snapshot_ts
          const prev = earliest.get(r.station_id)
          if (prev === undefined || ts < prev) {
            earliest.set(r.station_id, ts)
          }
        }
        totalPartitions++

        if (totalPartitions % 24 === 0) {
          console.log(`  scanned ${totalPartitions} partitions, ${earliest.size} stations found so far...`)
        }
      } catch (e: any) {
        if (e?.$metadata?.httpStatusCode === 404) continue
        throw e
      }
    }

    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined
  } while (continuationToken)

  console.log(`Scanned ${totalPartitions} partitions total, found ${earliest.size} unique stations`)
  return earliest
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
    console.log('Scanning all partitions to find earliest appearance per station...')
    const earliestByStation = await findEarliestPerStation(s3, env.R2_BUCKET!, systemId)

    const latestKey = `system:${systemId}:latest`
    const raw = await kv.get(latestKey)
    if (!raw) throw new Error(`KV ${latestKey} not found`)
    const parsed = JSON.parse(raw)

    let updated = 0
    let missing = 0
    for (const s of parsed.stations) {
      const ts = earliestByStation.get(s.station_id)
      if (ts !== undefined) {
        s.first_seen_ts = ts
        updated++
      } else {
        missing++
        console.log(`  ${s.station_id} (${s.name}): not found in any partition, keeping current first_seen_ts`)
      }
    }

    console.log(`Updated ${updated} stations with actual earliest appearance`)
    if (missing > 0) console.log(`${missing} stations not found in archive (brand new or renamed)`)

    await kv.put(latestKey, JSON.stringify(parsed))
    console.log(`Wrote patched snapshot to ${latestKey}`)
  })().catch(err => {
    console.error('backfill failed:', err)
    process.exit(1)
  })
}
