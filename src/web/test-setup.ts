import '@testing-library/jest-dom/vitest'

// Harmony's transitive dep `lottie-web` reaches for `canvas.getContext('2d')`
// at module import time. happy-dom returns null, so the import crashes with
// `Cannot set properties of null (setting 'fillStyle')`. We don't render any
// Lottie animations in tests, but the import is still pulled in via the
// Harmony barrel — so hand it a minimal mock 2D context to chew on.
if (typeof HTMLCanvasElement !== 'undefined') {
  const noop = () => {}
  const mockCtx: Record<string, unknown> = new Proxy(
    {},
    {
      get: () => noop,
      set: () => true,
    },
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HTMLCanvasElement.prototype.getContext = ((..._args: unknown[]) => mockCtx) as any
}

// `setImmediate` polyfill — same reason as `src/web/polyfills.ts` but for the
// happy-dom test env, where Harmony's transitive deps expect it.
type SetImmediateFn = (fn: (...args: unknown[]) => void, ...args: unknown[]) => number
type ClearImmediateFn = (handle: number) => void
const gt = globalThis as unknown as { setImmediate?: SetImmediateFn; clearImmediate?: ClearImmediateFn }
if (typeof gt.setImmediate === 'undefined') {
  gt.setImmediate = ((fn, ...args) => setTimeout(fn, 0, ...args)) as SetImmediateFn
  gt.clearImmediate = ((h) => clearTimeout(h)) as ClearImmediateFn
}
