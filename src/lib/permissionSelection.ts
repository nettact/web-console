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

// Path diagnostics has to RECEIVE the ICMP errors intermediate routers send back,
// which off Windows takes a raw socket — CAP_NET_RAW or root. ICMP *probing* does
// not: it only needs to send an echo and read the reply, which an unprivileged
// ping socket (SOCK_DGRAM/IPPROTO_ICMP) does whenever net.ipv4.ping_group_range
// covers the process gid — the default on common distributions and inside Docker.
// Measured: an unprivileged user and a plain non-root container both get ICMP
// probing and gateway probing; only path diagnostics needs the privileged path.
const NEEDS_RAW_SOCKET_OFF_WINDOWS = new Set([
  'diagnostic.traceroute.icmp',
  'diagnostic.traceroute.tcp',
])

// Windows capabilities that only an elevated process gets: the raw socket behind
// TCP path diagnostics, and the WMI ACPI thermal zone the temperature sensors are
// read through. The installer's scheduled task runs as SYSTEM, so both are
// usually satisfied in practice.
const NEEDS_ELEVATION_ON_WINDOWS = new Set([
  'diagnostic.traceroute.tcp',
  'host.temperature.read',
])

// Implemented only in the Windows and Linux builds today.
const NOT_ON_MACOS = new Set([
  'probe.icmp',
  'network.gateway.probe',
  'network.neighbor.read',
  'network.neighbor.hostname.read',
  'diagnostic.traceroute.icmp',
  'diagnostic.traceroute.tcp',
  // The macOS build reaches the sensors through cgo, which the agent does not use.
  'host.temperature.read',
])

// What to expect of a permission on a platform, used when choosing a policy at
// enrollment. This answers "will this work once granted?", so ICMP probing counts
// as plain `ok` on Linux: the usual configuration runs it unprivileged.
export function platformSupport(id: string, platform: EnrollPlatform): PlatformSupport {
  if (platform === 'macos') return NOT_ON_MACOS.has(id) ? 'unsupported' : 'ok'
  if (platform === 'windows') {
    // Raw-socket TCP path diagnostics and the WMI ACPI thermal zone are the
    // Windows capabilities that need an elevated process; the installer's
    // scheduled task runs as SYSTEM, so both are usually satisfied.
    return NEEDS_ELEVATION_ON_WINDOWS.has(id) ? 'privileged' : 'ok'
  }
  // Linux and the Linux-based container image behave identically here.
  return NEEDS_RAW_SOCKET_OFF_WINDOWS.has(id) ? 'privileged' : 'ok'
}

// Whether more privilege could enable a permission an agent reports as
// unsupported. This is a DIFFERENT question from platformSupport: ICMP probing
// normally works unprivileged on Linux, so the picker calls it `ok` — but if a
// particular agent still reports it unsupported (ping_group_range switched off,
// no CAP_NET_RAW), running privileged is exactly what fixes it. Answering the
// remediation question from the enrollment table would tell that operator the
// platform cannot do it, which is false.
export function privilegeCanEnable(id: string, platform: EnrollPlatform): boolean {
  if (platform === 'macos') return false // not implemented; privilege is irrelevant
  if (platform === 'windows') return NEEDS_ELEVATION_ON_WINDOWS.has(id)
  return (
    NEEDS_RAW_SOCKET_OFF_WINDOWS.has(id) || id === 'probe.icmp' || id === 'network.gateway.probe'
  )
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
