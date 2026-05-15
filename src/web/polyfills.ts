// Harmony pulls in `react-virtualized` (transitively, even when the components we
// use don't touch it), and react-virtualized expects `setImmediate` to exist as a
// global. Browsers don't ship it. Polyfill before anything else loads.
//
// Loaded as the first import in `main.tsx`. Side-effect import; no exports.

declare global {
  interface Window {
    setImmediate?: (fn: (...args: unknown[]) => void, ...args: unknown[]) => number
    clearImmediate?: (handle: number) => void
  }
}

if (typeof globalThis.setImmediate === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).setImmediate = (fn: (...args: unknown[]) => void, ...args: unknown[]) =>
    setTimeout(fn, 0, ...args)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).clearImmediate = (handle: number) => clearTimeout(handle)
}

export {}
