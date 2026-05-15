/**
 * Tailwind acts as a utility layer on top of Harmony. We don't load
 * `@tailwind base` (Harmony owns the reset), and most palette entries map
 * back to Harmony CSS variables so a class like `bg-surface` follows the
 * active light/dark theme automatically.
 */
export default {
  content: ['./index.html', './src/web/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surface tokens that flip with the theme
        surface: 'var(--app-bg-surface)',
        'surface-2': 'var(--app-bg-surface-2)',
        canvas: 'var(--app-bg)',
        ink: 'var(--app-text)',
        'ink-subdued': 'var(--app-text-subdued)',
        'ink-heading': 'var(--app-text-heading)',
        line: 'var(--app-border)',
        'line-strong': 'var(--app-border-strong)',
        accent: 'var(--app-accent)',
        warn: 'var(--app-warning)',
        danger: 'var(--app-danger)',
        ok: 'var(--app-success)',
      },
      boxShadow: {
        near: 'var(--app-shadow-near)',
        mid: 'var(--app-shadow-mid)',
        far: 'var(--app-shadow-far)',
      },
      borderRadius: {
        s: 'var(--app-radius-s)',
        m: 'var(--app-radius-m)',
        l: 'var(--app-radius-l)',
      },
    },
  },
  plugins: [],
}
