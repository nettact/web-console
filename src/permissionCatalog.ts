import { reactive } from 'vue'
import { api, type PermissionCatalogEntry, type PermissionBundle } from './api'

// Shared, lazily-loaded permission catalog. The enrollment screen needs to know
// which permissions exist and how they depend on each other before any agent has
// been installed, so it cannot use the per-agent inventory. Loaded once and
// shared, mirroring serverInfo.
//
// A failed load leaves the catalog empty, which the enrollment UI treats as "no
// permission chooser": the install command still works and the agent comes up on
// its built-in default policy. Losing an optional chooser is a much better
// failure than blocking enrollment.
export const permissionCatalog = reactive<{
  loaded: boolean
  permissions: PermissionCatalogEntry[]
  bundles: PermissionBundle[]
}>({
  loaded: false,
  permissions: [],
  bundles: [],
})

let inflight: Promise<void> | null = null

// Game monitoring is paused: its console entry points are hidden, so the chooser
// must not be able to grant a permission nothing in the UI can show the result
// of. The catalog is server-sent and the server still publishes these, so the
// filter lives here — the one place catalog data enters the console — rather
// than in each picker. Bundles are filtered too: `full` is defined as every
// compiled permission, which would otherwise reintroduce them behind one radio.
// Only the authorization pickers read this store; the Agent detail page's
// read-only permission inventory comes from the agent and is unaffected.
const isGamePermission = (id: string) => id.startsWith('game.')

export function ensurePermissionCatalog(): Promise<void> {
  if (permissionCatalog.loaded) return Promise.resolve()
  if (inflight) return inflight
  // Wrap the call so a synchronous throw (e.g. a stubbed api in tests) becomes a
  // rejection the catch below swallows, rather than escaping a lifecycle hook.
  inflight = Promise.resolve()
    .then(() => api.permissionCatalog())
    .then((c) => {
      permissionCatalog.permissions = (c.permissions || []).filter((p) => !isGamePermission(p.id))
      permissionCatalog.bundles = (c.bundles || []).map((b) => ({
        ...b,
        permissions: (b.permissions || []).filter((id) => !isGamePermission(id)),
      }))
      permissionCatalog.loaded = true
    })
    .catch(() => {
      /* leave it empty; the enrollment command works without a chooser */
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}
