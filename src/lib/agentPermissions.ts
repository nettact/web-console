// Turns an agent's full permission inventory into the four groups the Agent
// detail page renders, and decides which remediation flow each non-effective
// permission opens. Pure logic — i18n labels live in composables/usePermissionMeta.
//
// The server reports three independent booleans per permission (granted =
// operator policy, supported = build + platform + run mode, effective = the
// usable result). Every combination has a distinct cause and a distinct fix, and
// conflating them is how a console ends up telling someone to set an environment
// variable that can never work:
//
//   effective                        → working, nothing to do
//   !granted && supported            → notGranted: a policy edit turns it on
//   !granted && !supported           → unsupported: listed so the capability gap
//                                      is visible; a policy edit alone won't do it
//   granted && !supported            → blocked: elevation or a hard platform gap
//   granted && supported && !effective → blocked via an unmet dependency (a
//                                      required parent isn't effective)

import type { AgentPermission } from '../api'
import { componentCanEnable, privilegeCanEnable, type EnrollPlatform } from './permissionSelection'

// Which remediation flow a permission opens. `dependency` is the case where the
// permission itself is fine but a parent it needs isn't effective. `component`
// is a capability that arrives with separately-installed software rather than
// with the agent build.
export type RemediationCategory =
  | 'permission_blocked'
  | 'elevation'
  | 'component'
  | 'unsupported'
  | 'dependency'

// The agent reports runtime.GOOS on Windows and macOS but a distribution id on
// Linux (ubuntu, debian, alpine, …), so anything that is not windows or darwin is
// treated as Linux. Containers are indistinguishable from Linux here and need no
// distinction — the capability rules are identical.
export function agentPlatform(reported: string): EnrollPlatform {
  const p = (reported || '').trim().toLowerCase()
  if (p === 'windows') return 'windows'
  if (p === 'darwin' || p === 'macos') return 'macos'
  return 'linux'
}

export interface PermissionBuckets {
  effective: string[]
  notGranted: string[]
  blocked: string[]
  unsupported: string[]
}

export function bucketAgentPermissions(perms: AgentPermission[]): PermissionBuckets {
  const buckets: PermissionBuckets = { effective: [], notGranted: [], blocked: [], unsupported: [] }
  for (const p of perms) {
    if (p.effective) buckets.effective.push(p.id)
    else if (p.granted) buckets.blocked.push(p.id)
    else if (p.supported) buckets.notGranted.push(p.id)
    else buckets.unsupported.push(p.id)
  }
  return buckets
}

// The remediation flow for a non-effective permission. Granted-but-supported can
// only fail on a dependency; everything else is a capability or a policy gap.
//
// Whether a capability gap is fixable depends on the PLATFORM, not on the
// permission id: `probe.icmp` on a Linux agent without CAP_NET_RAW is fixed by
// running it privileged, while the same permission on macOS is simply not
// implemented. Deciding from the id alone told Linux operators that elevation
// could not help (it can) and told macOS operators to run as Administrator (it
// changes nothing).
export function categoryFor(p: AgentPermission, platform: EnrollPlatform): RemediationCategory {
  if (p.granted && p.supported) return 'dependency'
  if (!p.granted && p.supported) return 'permission_blocked'
  // Not supported by this agent. Lead with the capability gap; when the
  // permission is also ungranted the dialog still shows the policy line, flagged
  // as not sufficient on its own.
  //
  // A missing component is checked before privilege because it is the more
  // specific answer and, on the permissions where both could be argued, the true
  // one: frame data needs the PresentMon service, and once that service holds
  // the trace session the agent needs no privilege at all. Telling someone to
  // run as Administrator there would be advice that works by accident and stops
  // working the moment they stop doing it.
  //
  // The report says only that support is absent, never why, so this cause is a
  // best guess and the dialog says as much. The alternatives it cannot rule out
  // — an Agent build that ships no sensor at all, or one that never probed
  // because the permission was not granted — are covered there rather than by
  // silently choosing a different cause here, because choosing wrongly in either
  // direction ends in a remedy that cannot work.
  if (componentCanEnable(p.id, platform)) return 'component'
  return privilegeCanEnable(p.id, platform) ? 'elevation' : 'unsupported'
}

export function permissionById(perms: AgentPermission[], id: string): AgentPermission | undefined {
  return perms.find((p) => p.id === id)
}
