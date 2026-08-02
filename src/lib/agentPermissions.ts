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
//
// An unsupported row may also carry `unsupported_reason`, the agent's own answer
// to "why". It is optional in both directions: absent means the capability was
// never probed, and the vocabulary can grow, so every reader here treats an
// unknown code exactly like an absent one.

import type { AgentPermission } from '../api'
import { componentCanEnable, privilegeCanEnable, type EnrollPlatform } from './permissionSelection'

// Which remediation flow a permission opens. `dependency` is the case where the
// permission itself is fine but a parent it needs isn't effective. `component`
// is a capability that arrives with separately-installed software rather than
// with the agent build. `agent_sensor` is the other half of that story: the
// separately-installed software is not the problem — the Agent's own sensor part
// is absent, mismatched with the rest of the build, or failing at runtime, and
// no amount of installing or reinstalling PresentMon touches any of it.
export type RemediationCategory =
  | 'permission_blocked'
  | 'elevation'
  | 'component'
  | 'agent_sensor'
  | 'unsupported'
  | 'dependency'

// The codes an agent can attach to an unsupported permission, and the flow each
// one belongs in. Grouped by WHO has to act, because that is the only thing the
// reader can do anything about:
//
//   component    — the PresentMon side. Missing, not running, or too old: a
//                  person can install, start, or update it.
//   agent_sensor — the Agent's own sensor side. Either this build ships no
//                  sensor, the sensor and the Agent are from different builds,
//                  or the sensor failed while running. PresentMon is fine in
//                  every one of these; telling someone to install it is the bug
//                  this table exists to prevent.
//   unsupported  — nothing to install anywhere: the OS or the hardware has
//                  nothing to give.
//
// A Map rather than an object literal so a reason like "constructor" cannot
// inherit a truthy value off Object.prototype and be mistaken for a known code.
const REASON_CATEGORY = new Map<string, RemediationCategory>([
  ['presentmon_missing', 'component'],
  ['service_unavailable', 'component'],
  ['version_mismatch', 'component'],
  ['proto_mismatch', 'agent_sensor'],
  ['sensor_missing', 'agent_sensor'],
  ['probe_failed', 'agent_sensor'],
  ['sensor_exited', 'agent_sensor'],
  ['internal_error', 'agent_sensor'],
  ['session_lost', 'agent_sensor'],
  ['unsupported_os', 'unsupported'],
  ['gpu_telemetry_unavailable', 'unsupported'],
])

// What the console actually knows about the cause. Three states, not two:
//
//   known        — a code with text behind it. Say it plainly, no hedge.
//   unknown_code — the agent DID report a cause; this console build has no text
//                  for it (a newer agent, or a code added since this build).
//   not_reported — no code at all: either the capability was never probed
//                  because nothing granted it, or the agent predates the field.
//
// The last two collapse for ROUTING — neither can pick a flow, so both fall back
// to the platform guess — but they must never collapse for WORDING. Saying "this
// agent reported no cause" about an agent that reported one we cannot read is
// false, and the advice that follows from it ("grant it and restart to get a
// real answer") is wrong for a permission that is already granted. Callers
// rendering an explanation take this, not `reasonCategory`.
export type UnsupportedReasonState = 'known' | 'unknown_code' | 'not_reported'

export function unsupportedReasonState(reason: string | undefined): UnsupportedReasonState {
  if (!reason) return 'not_reported'
  return REASON_CATEGORY.has(reason) ? 'known' : 'unknown_code'
}

// The flow a known reason code belongs in, or undefined for both of the other
// states — the console has to fall back to guessing, and to saying so.
export function reasonCategory(reason: string | undefined): RemediationCategory | undefined {
  return reason ? REASON_CATEGORY.get(reason) : undefined
}

// Whether the console has a truthful explanation for this code, i.e. whether it
// may drop the hedge. False for both of the other states.
export function isKnownUnsupportedReason(reason: string | undefined): boolean {
  return unsupportedReasonState(reason) === 'known'
}

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
  // When the agent says WHY, believe it — over the platform tables, and on every
  // platform, since the report comes from the machine itself. This is the whole
  // point of the field: the console used to answer every unsupported game
  // permission with "Intel PresentMon is not installed", which sent at least one
  // user with a healthy PresentMon off to reinstall it while the actual cause
  // was a stale sensor binary speaking an older agent↔sensor protocol. That
  // cause needs the Agent updated and is untouched by anything PresentMon does.
  const known = reasonCategory(p.unsupported_reason)
  if (known) return known
  // No reason, or one this console does not recognise. An absent reason means
  // the agent never probed the capability (it does not probe what nothing
  // granted), not that the probe failed, so there is nothing to report and the
  // old guess is still the best available answer — the dialog keeps its "this is
  // the likeliest cause, not a certain one" hedge on exactly this path.
  //
  // A missing component is guessed before privilege because it is the more
  // specific answer and, on the permissions where both could be argued, the true
  // one: frame data needs the PresentMon service, and once that service holds
  // the trace session the agent needs no privilege at all. Telling someone to
  // run as Administrator there would be advice that works by accident and stops
  // working the moment they stop doing it.
  if (componentCanEnable(p.id, platform)) return 'component'
  return privilegeCanEnable(p.id, platform) ? 'elevation' : 'unsupported'
}

export function permissionById(perms: AgentPermission[], id: string): AgentPermission | undefined {
  return perms.find((p) => p.id === id)
}
