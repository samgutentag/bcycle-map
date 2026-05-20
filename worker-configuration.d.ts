import type { KVNamespace, R2Bucket } from '@cloudflare/workers-types'

export type Env = {
  GBFS_KV: KVNamespace
  GBFS_R2: R2Bucket
  SYSTEMS_JSON_URL?: string
  GITHUB_TOKEN?: string  // used by smoke worker
  GITHUB_REPO?: string   // e.g. "samgutentag/bcycle-map"
  // Same server-side key the travel-times pipeline uses. Stays in the worker —
  // never exposed to the web bundle. Proxies the geocoding fallback used by
  // NearbyStationsSheet when browser geolocation is denied.
  GOOGLE_MAPS_API_KEY?: string
}
