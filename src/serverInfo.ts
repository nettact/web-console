import { reactive } from 'vue'
import { api, type ServerInfo, type UpdateInfo } from './api'

// Shared, lazily-loaded server-info singleton. Several views need only one fact —
// whether this server runs the desktop all-in-one (its embedded Agent has a fixed
// FullAccess policy, so environment/YAML permission remediation never applies) —
// so rather than each fetch it independently we load once and share the result.
// A failed load leaves `desktop=false`, the safe default (show the full non-desktop
// remediation guidance rather than hide it), and `update=null`, which hides every
// piece of update UI.
export const serverInfo = reactive<{
  loaded: boolean
  desktop: boolean
  os: string
  update: UpdateInfo | null
}>({
  loaded: false,
  desktop: false,
  os: '',
  update: null,
})

// publishServerInfo shares a payload the caller already fetched. A view that
// reads /server-info for fields this store does not keep (Settings.vue needs
// `listen` and `native_notify`) publishes it here rather than leaving a second,
// separately-aging copy of `update` behind it — that block changes while a page
// sits open, and two snapshots of it drift apart.
export function publishServerInfo(si: ServerInfo): void {
  serverInfo.desktop = si.listen?.desktop === true
  serverInfo.os = si.os
  serverInfo.update = si.update ?? null
  serverInfo.loaded = true
}

let inflight: Promise<void> | null = null

// Re-fetch server-info even though it is already loaded. Most of the payload is
// fixed for the life of the server, but `update` is not: the server publishes it
// only once its first check succeeds, so a console opened moments after the
// server started would otherwise cache "no update block" for the tab's lifetime.
export function refreshServerInfo(): Promise<void> {
  serverInfo.loaded = false
  return ensureServerInfo()
}

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
    .then(publishServerInfo)
    .catch(() => {
      /* leave defaults; a non-desktop assumption keeps remediation guidance visible */
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}
