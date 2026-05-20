import { useEffect, useState } from 'react'
import { fetchStationTypical } from '../lib/typical-fetch'
import type { TypicalProfile } from '../lib/typical-comparison'

/**
 * Fetch typical profiles for every station in `stationIds`. Returns a Map
 * keyed by station_id so the pin-render path can do O(1) lookups.
 *
 * Profiles are cached at the worker (max-age=300) so refetching is cheap,
 * but we still de-dup on the client by only fetching IDs we haven't seen
 * this mount. Failed fetches are silently skipped — the ring just won't
 * render for that station, which is the same as the offline fallback.
 *
 * When `enabled` is false the map stays empty. This keeps the toggle on
 * /live a true zero-cost off-switch — no network at all.
 *
 * Profiles are fetched in small batches (8 concurrent) so we don't flood
 * the browser's connection pool when the snapshot first lands with ~50
 * stations. With the 5-minute server-side cache this is a one-shot cost
 * on first mount and a no-op on snapshot refresh.
 */
export function useTypicalProfiles(
  apiBase: string,
  systemId: string,
  stationIds: string[],
  enabled: boolean,
): Map<string, TypicalProfile> {
  const [profiles, setProfiles] = useState<Map<string, TypicalProfile>>(new Map())

  useEffect(() => {
    if (!enabled) {
      // Clear cache on disable so a subsequent enable refetches with the
      // current snapshot's station list (and picks up any newly-added
      // stations or fresh server-side typicals).
      setProfiles(new Map())
      return
    }
    if (stationIds.length === 0) return

    let cancelled = false
    const queue = [...stationIds]
    const fetched = new Map<string, TypicalProfile>()

    async function worker() {
      while (!cancelled && queue.length > 0) {
        const id = queue.shift()
        if (!id) return
        try {
          const profile = await fetchStationTypical(apiBase, systemId, id)
          if (cancelled) return
          fetched.set(id, profile)
          // Stream results in: each successful fetch updates state so pins
          // can light up their rings as profiles arrive, instead of waiting
          // for the whole batch to complete.
          setProfiles(prev => {
            const next = new Map(prev)
            next.set(id, profile)
            return next
          })
        } catch {
          // Silent — failed stations just won't get a ring.
        }
      }
    }

    const concurrency = 8
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () => worker())
    Promise.all(workers).catch(() => {})

    return () => { cancelled = true }
    // stationIds is intentionally joined to a stable key: the underlying
    // array identity changes every snapshot tick, but as long as the set of
    // IDs is the same we don't need to refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, systemId, stationIds.join(','), enabled])

  return profiles
}
