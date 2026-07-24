import { reactive } from 'vue'
import { api } from './api'

// Shared, lazily-loaded server-info singleton. Several views need only one fact —
// whether this server runs the desktop all-in-one (its embedded Agent has a fixed
// FullAccess policy, so environment/YAML permission remediation never applies) —
// so rather than each fetch it independently we load once and share the result.
// A failed load leaves `desktop=false`, the safe default (show the full non-desktop
// remediation guidance rather than hide it).
export const serverInfo = reactive<{ loaded: boolean; desktop: boolean; os: string }>({
  loaded: false,
  desktop: false,
  os: '',
})

let inflight: Promise<void> | null = null

// Ensure server-info is loaded exactly once (concurrent callers share the same
// in-flight request). Resolves immediately once already loaded.
export function ensureServerInfo(): Promise<void> {
  if (serverInfo.loaded) return Promise.resolve()
  if (inflight) return inflight
  // Wrap the call so a synchronous throw (e.g. a stubbed api in tests) becomes a
  // rejection the catch below swallows, rather than propagating out of a lifecycle
  // hook.
  inflight = Promise.resolve()
    .then(() => api.serverInfo())
    .then((si) => {
      serverInfo.desktop = si.listen?.desktop === true
      serverInfo.os = si.os
      serverInfo.loaded = true
    })
    .catch(() => {
      /* leave defaults; a non-desktop assumption keeps remediation guidance visible */
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}
