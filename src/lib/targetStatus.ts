// Pure presentation metadata for the authoritative target-status enums
// (STATUS-001). Tone mapping only — no i18n here; label resolution lives in the
// templates via `targetStatus.<dim>.<state>` keys (see locales). Every current
// target-health surface (Monitoring, Target Status, Dashboard) shares these maps
// so the badge tone for a given machine state is identical everywhere.

import type {
  AgentOverallStatus,
  DisplayState,
  ExecutionState,
  FaultState,
  ProbeState,
  TargetAgentStatusRow,
} from '../api'

// good = healthy/collecting, bad = a confirmed fault or failing probe, warn =
// degraded or a confirmation in progress, unknown = pending / offline / no-data /
// not-applicable. Text is always shown alongside the tone, never colour alone.
export type Tone = 'good' | 'bad' | 'warn' | 'unknown'

export const DISPLAY_TONE: Record<DisplayState, Tone> = {
  healthy: 'good',
  faulted: 'bad',
  confirming: 'warn',
  partial_failure: 'bad',
  probe_failed: 'bad',
  blocked: 'warn',
  agent_offline: 'unknown',
  pending: 'unknown',
  stale: 'warn',
  no_data: 'unknown',
  disabled: 'unknown',
  unassigned: 'unknown',
}

export const EXECUTION_TONE: Record<ExecutionState, Tone> = {
  collecting: 'good',
  pending: 'unknown',
  permission_blocked: 'bad',
  target_blocked: 'warn',
  unsupported: 'warn',
  agent_offline: 'unknown',
  disabled: 'unknown',
  unassigned: 'unknown',
}

export const PROBE_TONE: Record<ProbeState, Tone> = {
  healthy: 'good',
  failed: 'bad',
  stale: 'warn',
  no_data: 'unknown',
  not_applicable: 'unknown',
}

export const FAULT_TONE: Record<FaultState, Tone> = {
  normal: 'good',
  confirming: 'warn',
  faulted: 'bad',
}

// Per-agent overall status (AGENT-001). offline is bad (unreachable), abnormal is
// warn (firing faults / issues while online), never_connected is unknown, ok good.
export const AGENT_TONE: Record<AgentOverallStatus, Tone> = {
  offline: 'bad',
  abnormal: 'warn',
  never_connected: 'unknown',
  ok: 'good',
}

// A target's display_state is "abnormal" (worth surfacing / counting as a problem)
// for anything that is not a clean healthy/disabled/unassigned baseline.
const HEALTHY_DISPLAY = new Set<DisplayState>(['healthy', 'disabled', 'unassigned'])
export function isAbnormalDisplay(state: DisplayState): boolean {
  return !HEALTHY_DISPLAY.has(state)
}

// The dimension shown as the per-agent headline: a non-collecting execution state
// dominates (why the pair is not running); a collecting pair reports its probe
// state; the fault state is surfaced as an extra tag by the caller.
export function agentHeadlineTone(row: TargetAgentStatusRow): Tone {
  if (row.execution_state !== 'collecting') return EXECUTION_TONE[row.execution_state]
  if (row.probe_state === 'not_applicable') return FAULT_TONE[row.fault_state]
  return PROBE_TONE[row.probe_state]
}

// Render a 0..1 ratio with more precision as it approaches 100%. Never round an
// observed failure up to 100%: unavailability evidence takes precedence over a
// cosmetically rounded headline. No verdict remains unknown rather than 0%.
export function formatAvailability(ratio: number | undefined): string | null {
  if (ratio === undefined || ratio === null || Number.isNaN(ratio)) return null
  const clamped = Math.min(Math.max(ratio, 0), 1)
  if (clamped >= 1) return '100%'
  const percent = clamped * 100
  const digits = percent >= 99.99 ? 3 : percent >= 99.9 ? 2 : 1
  const scale = 10 ** digits
  return `${Math.floor(percent * scale) / scale}%`
}

export function formatAvailabilityRounds(ok: number | undefined, total: number | undefined): string | null {
  if (!total || ok == null) return null
  return `${ok.toLocaleString()} / ${total.toLocaleString()}`
}

// availabilityTone grades a ratio for the badge beside it. The thresholds are
// deliberately generous: a home link that drops one probe round an hour is not
// broken, but a target below ~95% is losing rounds often enough to matter.
export function availabilityTone(ratio: number | undefined): Tone {
  if (ratio === undefined) return 'unknown'
  if (ratio >= 0.995) return 'good'
  if (ratio >= 0.95) return 'warn'
  return 'bad'
}
