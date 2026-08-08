// Derived facts about detection settings: the small amount of logic the console
// needs ON TOP of the shapes in api.ts.
//
// They live here rather than in api.ts because api.ts is mocked wholesale in
// component tests — a runtime value exported from it disappears under the mock
// and takes the component with it. Types are erased and stay there; values that
// a component actually calls belong somewhere a test does not replace.
import type { DetectionProfile } from '../api'

// Round counts per named profile. Mirrors ProfileRounds in
// server-core/fault/round.go. This is a pre-save preview only: the server
// normalizes and returns the authoritative numbers on every save, so a drift here
// is visible for one click and then corrected, never persisted.
export const PROFILE_ROUNDS: Record<string, { fail: number; recover: number }> = {
  balanced: { fail: 3, recover: 2 },
  fast: { fail: 2, recover: 2 },
  stable: { fail: 5, recover: 3 },
}

export function profileRounds(p: DetectionProfile): { fail: number; recover: number } | undefined {
  return PROFILE_ROUNDS[p]
}

// Whether a detector key belongs to the baseline-relative quality family
// (ALERT-003). Those signals say "worse than usual", not "not working", and every
// surface that renders both has to tell them apart: same list, different claim.
export function isDegradation(detectorKey: string): boolean {
  return detectorKey === 'latency_degradation' || detectorKey === 'loss_degradation'
}

// The system-status families. Mirrors the Detector* constants in
// server-core/fault/fault.go.
const HOST_FAMILIES = ['host_cpu', 'host_mem', 'host_load', 'host_net', 'host_disk']

// Split a stored detector key into its family and its subject. The two host
// families that watch more than one thing per machine fold their subject in after
// a '|' — 'host_disk|C:', 'host_net|rx' — so nothing may compare a whole key
// against a family name. A key with no subject comes back unchanged with an empty
// subject, so every key can be run through this unconditionally.
export function splitDetectorKey(detectorKey: string): { family: string; subject: string } {
  const i = detectorKey.indexOf('|')
  if (i < 0) return { family: detectorKey, subject: '' }
  return { family: detectorKey.slice(0, i), subject: detectorKey.slice(i + 1) }
}

// Whether a detector key belongs to the system-status family: a claim about this
// machine's own resources rather than about the network. Surfaces that render
// both need to tell them apart — a full disk is not a connectivity problem, and
// nothing about the path explains it.
export function isHostDetector(detectorKey: string): boolean {
  return HOST_FAMILIES.includes(splitDetectorKey(detectorKey).family)
}
