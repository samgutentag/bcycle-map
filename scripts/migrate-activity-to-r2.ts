/**
 * One-shot migration: copy the activity log JSON from Cloudflare KV to R2.
 *
 * Future reads/writes target R2 directly; this script exists solely to lift
 * the existing log (events + trips + in-flight state) out of KV so the
 * R2-backed code path has data to serve on first deploy.
 *
 * Idempotent: re-running overwrites the R2 object with whatever KV currently
 * holds. The KV value is intentionally left in place so Sam can verify
 * before deleting it manually.
 */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { activityKey, activityR2Key } from '../src/shared/activity'

type KVClient = {
  get(key: string): Promise<string | null>
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
  }
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
    const kvKey = activityKey(systemId)
    const r2Key = activityR2Key(systemId)

    const kv = makeKVClient({
      accountId: env.CF_ACCOUNT_ID!,
      namespaceId: env.CF_KV_NAMESPACE_ID!,
      token: env.CF_KV_API_TOKEN!,
    })

    console.log(`Reading ${kvKey} from KV...`)
    const raw = await kv.get(kvKey)
    if (raw === null) {
      console.log('nothing in KV to migrate')
      return
    }
    console.log(`Read ${raw.length} bytes from KV.`)

    const s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${env.CF_ACCOUNT_ID!}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY! },
    })

    console.log(`Writing to R2: ${env.R2_BUCKET}/${r2Key} (overwrites if present)...`)
    await s3.send(new PutObjectCommand({
      Bucket: env.R2_BUCKET!,
      Key: r2Key,
      Body: raw,
      ContentType: 'application/json',
    }))
    console.log(`Wrote ${raw.length} bytes to R2 at ${r2Key}.`)
    console.log('KV value left in place — delete manually once R2 read path is verified.')
  })().catch(err => {
    console.error('migrate-activity-to-r2 failed:', err)
    process.exit(1)
  })
}
