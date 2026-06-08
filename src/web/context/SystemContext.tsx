import { createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode } from 'react'
import { fetchSystems } from '../lib/systems-api'
import type { SystemIndexEntry } from '@shared/systems-index'

export const SYSTEM_LS_KEY = 'bcycle-map:system'

type SystemContextValue = {
  systemId: string
  systems: SystemIndexEntry[]
  activeSystem: SystemIndexEntry | null
  setSystemId: (id: string) => void
}

const SystemContext = createContext<SystemContextValue | null>(null)

function readPersisted(): string | null {
  if (typeof window === 'undefined') return null
  try { return window.localStorage.getItem(SYSTEM_LS_KEY) } catch { return null }
}

function persist(id: string): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(SYSTEM_LS_KEY, id) } catch { /* private mode */ }
}

/** Pure resolver — precedence: valid persisted → nearest → first → fallback. */
export function resolveActiveSystem(args: {
  persisted: string | null
  nearestId: string | null
  ids: string[]
  fallback: string
}): string {
  const { persisted, nearestId, ids, fallback } = args
  if (persisted && ids.includes(persisted)) return persisted
  if (nearestId && ids.includes(nearestId)) return nearestId
  if (ids.length > 0) return ids[0]!
  return fallback
}

type ProviderProps = { children: ReactNode; defaultSystemId: string }

export function SystemProvider({ children, defaultSystemId }: ProviderProps) {
  const [systemId, setSystemIdState] = useState<string>(() => readPersisted() ?? defaultSystemId)
  const [systems, setSystems] = useState<SystemIndexEntry[]>([])

  useEffect(() => {
    let cancelled = false
    fetchSystems()
      .then(resp => {
        if (cancelled) return
        setSystems(resp.systems)
        const resolved = resolveActiveSystem({
          persisted: readPersisted(),
          nearestId: resp.nearestId,
          ids: resp.systems.map(s => s.systemId),
          fallback: defaultSystemId,
        })
        setSystemIdState(resolved)
        persist(resolved)
      })
      .catch(() => { /* keep default; offline or endpoint missing */ })
    return () => { cancelled = true }
  }, [defaultSystemId])

  const setSystemId = useCallback((id: string) => {
    setSystemIdState(id)
    persist(id)
  }, [])

  const value = useMemo<SystemContextValue>(() => ({
    systemId,
    systems,
    activeSystem: systems.find(s => s.systemId === systemId) ?? null,
    setSystemId,
  }), [systemId, systems, setSystemId])

  return <SystemContext.Provider value={value}>{children}</SystemContext.Provider>
}

/**
 * Active system. Outside a provider (component unit tests that don't wrap the
 * tree) it falls back to the SB default so components don't crash.
 */
export function useSystem(): SystemContextValue {
  const ctx = useContext(SystemContext)
  if (ctx) return ctx
  return {
    systemId: 'bcycle_santabarbara',
    systems: [],
    activeSystem: null,
    setSystemId: () => {},
  }
}

type HarnessProps = { value: SystemContextValue; children: ReactNode }
/** Test seam: inject a fixed context value. Not used in production. */
export function SystemContextTestHarness({ value, children }: HarnessProps) {
  return <SystemContext.Provider value={value}>{children}</SystemContext.Provider>
}
