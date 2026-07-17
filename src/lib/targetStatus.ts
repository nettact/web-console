// Pure presentation metadata for the authoritative target-status enums
// (STATUS-001). Tone mapping only — no i18n here; label resolution lives in the
// templates via `targetStatus.<dim>.<state>` keys (see locales). Every current
// target-health surface (Monitoring, Target Status, Dashboard) shares these maps
// so the badge tone for a given machine state is identical everywhere.

import type {
  DisplayState,
  ExecutionState,
  ProbeState,
  RuleState,
  TargetAgentStatusRow,
} from '../api'

// good = healthy/collecting, bad = failing/alerting, warn = degraded/breaching,
// unknown = pending / offline / no-data / not-applicable. Text is always shown
// alongside the tone, never colour alone.
export type Tone = 'good' | 'bad' | 'warn' | 'unknown'

export const DISPLAY_TONE: Record<DisplayState, Tone> = {
  healthy: 'good',
  alerting: 'bad',
  breaching: 'warn',
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

export const RULE_TONE: Record<RuleState, Tone> = {
  normal: 'good',
  breaching: 'warn',
  alerting: 'bad',
}

// A target's display_state is "abnormal" (worth surfacing / counting as a problem)
// for anything that is not a clean healthy/disabled/unassigned baseline.
const HEALTHY_DISPLAY = new Set<DisplayState>(['healthy', 'disabled', 'unassigned'])
export function isAbnormalDisplay(state: DisplayState): boolean {
  return !HEALTHY_DISPLAY.has(state)
}

// The dimension shown as the per-agent headline: a non-collecting execution state
// dominates (why the pair is not running); a collecting pair reports its probe
// state; alerting/breaching rule state is surfaced as an extra tag by the caller.
export function agentHeadlineTone(row: TargetAgentStatusRow): Tone {
  if (row.execution_state !== 'collecting') return EXECUTION_TONE[row.execution_state]
  if (row.probe_state === 'not_applicable') return RULE_TONE[row.rule_state] // host: rule/normal
  return PROBE_TONE[row.probe_state]
}
