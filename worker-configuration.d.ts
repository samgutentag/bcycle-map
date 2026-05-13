/// <reference types="@cloudflare/workers-types" />

export type Env = {
  GBFS_KV: KVNamespace
  GBFS_R2: R2Bucket
  SYSTEMS_JSON_URL?: string
  GITHUB_TOKEN?: string  // used by smoke worker
  GITHUB_REPO?: string   // e.g. "samgutentag/bcycle-map"
}
