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
