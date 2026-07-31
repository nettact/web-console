import { reactive } from 'vue'
import { api } from './api'

// The console address new Agents are pointed at. It comes from the
// `console_base_url` setting rather than `window.location.origin`, because the
// address the operator reaches the console on is frequently not one an Agent on
// another machine can use — `localhost`, an SSH tunnel, or the desktop build's
// ephemeral 127.0.0.1 port. That setting is the single place where a reachable
// address is declared, so the enrollment command has to follow it.
//
// Seeded with the current origin so a command is never blank before the setting
// loads, and because that is exactly what auth.ts stores on first login.
export const consoleBase = reactive<{ url: string; loaded: boolean }>({
  url: normalize(window.location.origin),
  loaded: false,
})

// Trailing slashes are stripped: the Agent appends its API paths to this value
// verbatim, so "http://host:12450/" would produce "//api/..." requests.
function normalize(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

// setConsoleBase records a value the caller already has in hand (a settings read
// or a successful save), so keeping the shared address current never costs an
// extra request. An empty setting falls back to the address this console is
// being viewed on.
export function setConsoleBase(value: string): void {
  consoleBase.url = normalize(value) || normalize(window.location.origin)
  consoleBase.loaded = true
}

let inflight: Promise<void> | null = null

// ensureConsoleBase loads the setting once. A failed load leaves the seeded
// origin in place: enrolling from the address the operator is already using is a
// far better failure than an enrollment command with no server in it.
export function ensureConsoleBase(): Promise<void> {
  if (consoleBase.loaded) return Promise.resolve()
  if (inflight) return inflight
  // Wrap the call so a synchronous throw (e.g. a stubbed api in tests) becomes a
  // rejection the catch below swallows, rather than escaping a lifecycle hook.
  inflight = Promise.resolve()
    .then(() => api.settings())
    .then((s) => setConsoleBase(s['console_base_url'] || ''))
    .catch(() => {
      /* keep the seeded origin */
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}
