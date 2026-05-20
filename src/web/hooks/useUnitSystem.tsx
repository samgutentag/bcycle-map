import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_UNIT_SYSTEM, type UnitSystem } from '../lib/units'

/**
 * App-wide imperial/metric preference (#16).
 *
 * The preference is hydrated from localStorage on mount and written back on
 * every change. Distance + speed helpers in `src/web/lib/units.ts` take the
 * `UnitSystem` value directly so components stay testable without going
 * through the context in unit tests.
 */

export const UNIT_SYSTEM_LS_KEY = 'bcycle-map:unit-system'

type UnitSystemContextValue = {
  unitSystem: UnitSystem
  setUnitSystem: (next: UnitSystem) => void
}

const UnitSystemContext = createContext<UnitSystemContextValue | null>(null)

function readPersistedUnitSystem(): UnitSystem {
  if (typeof window === 'undefined') return DEFAULT_UNIT_SYSTEM
  try {
    const raw = window.localStorage.getItem(UNIT_SYSTEM_LS_KEY)
    if (raw === 'metric' || raw === 'imperial') return raw
  } catch {
    // localStorage may throw in private/quota'd contexts — fall through
    // to the default so the app still renders.
  }
  return DEFAULT_UNIT_SYSTEM
}

function persistUnitSystem(next: UnitSystem): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(UNIT_SYSTEM_LS_KEY, next)
  } catch {
    // Same rationale as above — toggle still flips in-session.
  }
}

type ProviderProps = {
  children: ReactNode
  /** Test seam — overrides the localStorage-hydrated value when provided. */
  initialValue?: UnitSystem
}

export function UnitSystemProvider({ children, initialValue }: ProviderProps) {
  const [unitSystem, setUnitSystemState] = useState<UnitSystem>(
    () => initialValue ?? readPersistedUnitSystem(),
  )

  const setUnitSystem = useCallback((next: UnitSystem) => {
    setUnitSystemState(next)
    persistUnitSystem(next)
  }, [])

  const value = useMemo(() => ({ unitSystem, setUnitSystem }), [unitSystem, setUnitSystem])
  return <UnitSystemContext.Provider value={value}>{children}</UnitSystemContext.Provider>
}

/**
 * Read the current unit system. Falls back to the default outside of a
 * provider (e.g. in component unit tests that don't wrap the tree) so
 * components don't crash and behave the same as a first-visit user.
 */
export function useUnitSystem(): UnitSystemContextValue {
  const ctx = useContext(UnitSystemContext)
  if (ctx) return ctx
  return {
    unitSystem: DEFAULT_UNIT_SYSTEM,
    setUnitSystem: () => {
      // No-op outside a provider. Tests that need to assert on the setter
      // should wrap with <UnitSystemProvider>.
    },
  }
}
