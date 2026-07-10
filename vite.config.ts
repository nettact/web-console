import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Dev proxy: the Vite dev server forwards /api to the Go server so the SPA and
// API share an origin during development. In production the SPA is embedded in
// the Go binary (go:embed, M4) and served same-origin.
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
  build: {
    // Self-contained output. The M4 embed step copies dist/ into the
    // server-lite repo (server-lite/internal/webui/dist) for go:embed.
    outDir: 'dist',
    emptyOutDir: true,
  },
})
