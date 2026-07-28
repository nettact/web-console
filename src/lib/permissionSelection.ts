// Selection logic for the enrollment permission chooser. Pure functions over the
// server-sent catalog — no dependency-graph walking happens here: each entry
// already carries its full transitive requirement set (`implies`), so selecting
// is a set union and deselecting is "drop anything that required it".
//
// Platform notes are the other half: a permission the target platform cannot run
// should not be silently included in an install command, and one that needs extra
// privilege should say so rather than appearing to work.

import type { PermissionCatalogEntry } from '../api'

export type EnrollPlatform = 'windows' | 'macos' | 'linux' | 'docker'

// How a permission behaves on a given platform.
//   ok         — works as soon as it is granted
//   privileged — the platform can do it, but only for a sufficiently privileged
//                process (root / Administrator / a container with NET_RAW)
//   unsupported — this platform's build cannot do it at all; granting is futile
export type PlatformSupport = 'ok' | 'privileged' | 'unsupported'

// Capabilities that need a raw ICMP socket. On Linux and in containers that means
// CAP_NET_RAW (root has it; the official image ships the file capability and the
// installer adds the capability to the container). On Windows the ICMP paths go
// through iphlpapi and need no elevation, except TCP path diagnostics.
const RAW_SOCKET_IDS = new Set([
  'probe.icmp',
  'network.gateway.probe',
  'diagnostic.traceroute.icmp',
  'diagnostic.traceroute.tcp',
])

// Implemented only in the Windows and Linux builds today.
const NOT_ON_MACOS = new Set([
  'probe.icmp',
  'network.gateway.probe',
  'network.neighbor.read',
  'network.neighbor.hostname.read',
  'diagnostic.traceroute.icmp',
  'diagnostic.traceroute.tcp',
])

export function platformSupport(id: string, platform: EnrollPlatform): PlatformSupport {
  if (platform === 'macos') return NOT_ON_MACOS.has(id) ? 'unsupported' : 'ok'
  if (platform === 'windows') {
    // Raw-socket TCP path diagnostics is the one Windows capability that needs an
    // elevated process; the installer's scheduled task runs as SYSTEM, so it is
    // usually satisfied.
    return id === 'diagnostic.traceroute.tcp' ? 'privileged' : 'ok'
  }
  // Linux and the Linux-based container image behave identically here.
  return RAW_SOCKET_IDS.has(id) ? 'privileged' : 'ok'
}

// selectWithDependencies returns the selection after ticking `id`: the permission
// plus everything it requires, since a child without its parent is inert.
export function selectWithDependencies(
  selected: ReadonlySet<string>,
  entry: PermissionCatalogEntry,
): Set<string> {
  const next = new Set(selected)
  next.add(entry.id)
  for (const dep of entry.implies || []) next.add(dep)
  return next
}

// deselectWithDependents returns the selection after unticking `id`: the
// permission plus every selected entry that required it. Leaving a dependent
// behind would produce a policy the agent rejects at startup.
export function deselectWithDependents(
  selected: ReadonlySet<string>,
  id: string,
  catalog: readonly PermissionCatalogEntry[],
): Set<string> {
  const next = new Set(selected)
  next.delete(id)
  for (const e of catalog) {
    if (next.has(e.id) && (e.implies || []).includes(id)) next.delete(e.id)
  }
  return next
}

// orderedSelection renders a selection as a policy value in the catalog's
// canonical order, so the same choice always produces the same command string.
export function orderedSelection(
  selected: ReadonlySet<string>,
  catalog: readonly PermissionCatalogEntry[],
): string[] {
  return catalog.filter((e) => selected.has(e.id)).map((e) => e.id)
}

export function sameSelection(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}

// permissionGroup buckets a permission id for display. Ordering the checks
// longest-prefix-first keeps the process/connection snapshot scopes out of the
// general host-metrics bucket.
export function permissionGroup(id: string): string {
  if (id.startsWith('host.process.')) return 'process'
  if (id.startsWith('host.connection.')) return 'connection'
  if (id.startsWith('host.')) return 'host'
  if (id.startsWith('probe.')) return 'probe'
  if (id.startsWith('diagnostic.')) return 'diagnostic'
  if (id.startsWith('network.')) return 'network'
  return 'other'
}

export const GROUP_ORDER = ['probe', 'network', 'host', 'process', 'connection', 'diagnostic', 'other']

// groupCatalog returns the catalog bucketed for display, in a stable order and
// skipping empty groups.
export function groupCatalog(
  catalog: readonly PermissionCatalogEntry[],
): Array<{ group: string; entries: PermissionCatalogEntry[] }> {
  const byGroup = new Map<string, PermissionCatalogEntry[]>()
  for (const e of catalog) {
    const g = permissionGroup(e.id)
    const list = byGroup.get(g)
    if (list) list.push(e)
    else byGroup.set(g, [e])
  }
  return GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({ group: g, entries: byGroup.get(g)! }))
}
