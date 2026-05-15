import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
// @ts-ignore — no upstream types
import fixReactVirtualized from 'esbuild-plugin-react-virtualized'

export default defineConfig({
  plugins: [react({ jsxImportSource: '@emotion/react' })],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@web': resolve(__dirname, 'src/web'),
    },
  },
  optimizeDeps: {
    // Harmony pulls in react-virtualized, which ships a broken proptype re-export
    // that crashes esbuild's optimizer. This plugin patches the offending file at
    // dep-bundling time. See https://github.com/bvaughn/react-virtualized/issues/1739.
    esbuildOptions: { plugins: [fixReactVirtualized] },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // Vendor split: keeps MapLibre + React in their own chunks so app-code
        // deploys don't bust those (large, slow-changing) caches.
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-maplibre': ['maplibre-gl'],
        },
      },
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/web/test-setup.ts'],
  },
})
