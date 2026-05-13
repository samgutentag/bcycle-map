type Opts = {
  fetchImpl?: typeof fetch
  backoffMs?: number
  timeoutMs?: number
}

export async function fetchJsonWithRetry<T = unknown>(
  url: string,
  opts: Opts = {}
): Promise<T> {
  const fetchFn = opts.fetchImpl ?? fetch
  const backoffMs = opts.backoffMs ?? 5000
  const timeoutMs = opts.timeoutMs ?? 10_000

  const attempt = async (): Promise<T> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetchFn(url, { signal: controller.signal })
      if (!res.ok) throw new Error(`${url} returned ${res.status}`)
      return await res.json() as T
    } finally {
      clearTimeout(timer)
    }
  }

  try {
    return await attempt()
  } catch (err) {
    await new Promise(r => setTimeout(r, backoffMs))
    return await attempt()
  }
}
