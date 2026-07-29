import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Dev proxy: the Vite dev server forwards /api to the Go server so the SPA and
// API share an origin during development. In production the SPA is served
// same-origin by the Go server, from one of two places: server deployments
// download this repo's release tarball at runtime, while the desktop app
// compiles it into its binary (store review disallows the runtime fetch).
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:12450', changeOrigin: true },
    },
  },
  build: {
    // Self-contained output: release.yml tars this directory as the
    // web-console-dist-<tag>.tar.gz release asset that both consumers unpack.
    outDir: 'dist',
    emptyOutDir: true,
  },
})
