import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ThemeProvider as HarmonyThemeProvider } from '@audius/harmony'

export type ThemeMode = 'light' | 'dark' | 'auto'

type Ctx = {
  mode: ThemeMode
  setMode: (m: ThemeMode) => void
  resolved: 'day' | 'dark'
}

const ThemeCtx = createContext<Ctx | null>(null)

const STORAGE_KEY = 'bcycle-map.theme'

function readStoredMode(): ThemeMode {
  if (typeof window === 'undefined') return 'auto'
  const v = window.localStorage.getItem(STORAGE_KEY)
  return v === 'light' || v === 'dark' || v === 'auto' ? v : 'auto'
}

function prefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredMode())
  const [systemDark, setSystemDark] = useState<boolean>(() => prefersDark())

  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', listener)
    return () => mq.removeEventListener('change', listener)
  }, [])

  const resolved = mode === 'auto' ? (systemDark ? 'dark' : 'day') : mode === 'dark' ? 'dark' : 'day'

  useEffect(() => {
    document.documentElement.dataset.theme = resolved
    document.documentElement.style.colorScheme = resolved === 'dark' ? 'dark' : 'light'
  }, [resolved])

  const setMode = (m: ThemeMode) => {
    window.localStorage.setItem(STORAGE_KEY, m)
    setModeState(m)
  }

  const value = useMemo<Ctx>(() => ({ mode, setMode, resolved }), [mode, resolved])

  return (
    <ThemeCtx.Provider value={value}>
      <HarmonyThemeProvider theme={resolved}>{children}</HarmonyThemeProvider>
    </ThemeCtx.Provider>
  )
}

export function useAppTheme(): Ctx {
  const v = useContext(ThemeCtx)
  if (!v) throw new Error('useAppTheme must be used inside <AppThemeProvider>')
  return v
}
