import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@web': resolve(__dirname, 'src/web'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
  build: {
    outDir: 'dist',
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/web/test-setup.ts'],
  },
})
