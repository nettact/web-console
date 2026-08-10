import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// The public status app: a second, self-contained SPA built out of the SAME
// repository into dist/status/, so one release tarball carries both and the
// server can serve them from one dist — while a deployer who wants the public
// page on its own host can copy dist/status/ anywhere and point config.js at the
// API. Nothing here imports from ../src: the console's client is session-bound
// and origin-relative, which is exactly what this app must not be.
//
// Two settings make the "copy it anywhere" promise real, and neither is
// cosmetic:
//   - base './' emits relative asset URLs, so the app works at the site root, at
//     /status/, or at any other prefix, with no rebuild.
//   - the app hash-routes (#/<slug>), so no static host needs a rewrite rule to
//     serve deep links.
export default defineConfig({
  plugins: [vue()],
  root: 'status',
  base: './',
  server: {
    port: 5174,
    proxy: {
      '/api': { target: 'http://localhost:12450', changeOrigin: true },
    },
  },
  build: {
    // Written INTO the console's dist, after it. outDir is outside root, so Vite
    // requires emptyOutDir explicitly — and because it points at dist/status
    // rather than dist, emptying it leaves the console build alone.
    outDir: '../dist/status',
    emptyOutDir: true,
  },
})
