/// <reference types="vite/client" />

// The runtime configuration the shell's config.js installs before the bundle
// loads. Optional at every level: a hand-edited config.js may be missing, empty,
// or partially filled in, and the app has a working default for all of it.
declare global {
  interface Window {
    NETTACT_STATUS_CONFIG?: { apiBase?: string }
  }
}

export {}
