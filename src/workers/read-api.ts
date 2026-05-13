import type { Env } from '../../worker-configuration'
import { latestKey } from './poller'

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    const match = url.pathname.match(/^\/api\/systems\/([^/]+)\/current$/)
    if (!match) return new Response('not found', { status: 404 })

    const systemId = match[1]!
    const raw = await env.GBFS_KV.get(latestKey(systemId))
    if (!raw) return new Response('not found', { status: 404, headers: CORS_HEADERS })

    return new Response(raw, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'content-type': 'application/json',
        'cache-control': 'max-age=60',
      },
    })
  },
}
