import { defineConfig } from 'vitest/config'

// In Cloudflare Workers we import from 'parquet-wasm/bundler' so wrangler/esbuild
// can inline the WASM module. Node-based test runners (Vitest) cannot resolve
// `.wasm` imports, so alias the bundler entry to the node entry for tests only.
export default defineConfig({
  resolve: {
    alias: {
      'parquet-wasm/bundler': 'parquet-wasm/node',
    },
  },
})
