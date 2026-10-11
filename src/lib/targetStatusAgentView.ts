import type {
  MonitorGroup,
  RouteAgentSummary,
  RouteTargetSummary,
  TargetAgentStatusRow,
  TargetStatusRow,
} from '../api'
import { isRouteAbnormal, isRouteTarget, routeAgentState, type RouteState } from './routeStatus'

export type TargetStatusView = 'agents' | 'targets'
export type AgentWorkspaceTab = 'overview' | 'targets' | 'history' | 'metrics' | 'processes' | 'connections'
export type AgentHistoryMode = 'connectivity' | 'target' | 'fluctuations'
// A route monitor (kind "trace") uses overview / path / changes; every other
// kind uses overview / agents / history. 'overview' is shared.
export type TargetWorkspaceTab = 'overview' | 'agents' | 'history' | 'path' | 'changes'
export const ROUTE_TARGET_TABS: TargetWorkspaceTab[] = ['overview', 'path', 'changes']
export const AVAILABILITY_TARGET_TABS: TargetWorkspaceTab[] = ['overview', 'agents', 'history']
export type AgentTargetTone = 'abnormal' | 'attention' | 'healthy' | 'inactive'

export interface AgentTargetView {
  target: TargetStatusRow
  agent: TargetAgentStatusRow
  groupName: string
  tone: AgentTargetTone
  // Set for route monitors only: this Agent's route summary (null until the
  // batch has it) and the route state derived from it.
  route?: { summary: RouteAgentSummary | null; state: RouteState }
}

export interface AgentTargetSummary {
  total: number
  abnormal: number
  attention: number
  healthy: number
  inactive: number
}

const TONE_RANK: Record<AgentTargetTone, number> = {
  abnormal: 0,
  attention: 1,
  healthy: 2,
  inactive: 3,
}

export function isTargetStatusView(value: string): value is TargetStatusView {
  return value === 'agents' || value === 'targets'
}

export function isAgentWorkspaceTab(value: string): value is AgentWorkspaceTab {
  return value === 'overview'
    || value === 'targets'
    || value === 'history'
    || value === 'metrics'
    || value === 'processes'
    || value === 'connections'
}

export function isAgentHistoryMode(value: string): value is AgentHistoryMode {
  return value === 'connectivity' || value === 'target' || value === 'fluctuations'
}

export function isTargetWorkspaceTab(value: string): value is TargetWorkspaceTab {
  return value === 'overview' || value === 'agents' || value === 'history' || value === 'path' || value === 'changes'
}

// Reads a `ttab` URL value. 'route' was the single route-monitor tab before the
// route workspace got its own tabs; old links land on its overview.
export function parseTargetWorkspaceTab(value: string): TargetWorkspaceTab {
  if (value === 'route') return 'overview'
  return isTargetWorkspaceTab(value) ? value : 'overview'
}

// The tab a workspace actually shows: a tab that belongs to the other kind of
// workspace falls back to the overview.
export function effectiveTargetTab(tab: TargetWorkspaceTab, routeTarget: boolean): TargetWorkspaceTab {
  const allowed = routeTarget ? ROUTE_TARGET_TABS : AVAILABILITY_TARGET_TABS
  return allowed.includes(tab) ? tab : 'overview'
}

// A route monitor's tone for one Agent. Only a blocked or stale route counts as
// abnormal; a route that merely changed is healthy (the change is surfaced as a
// separate hint), and one still waiting for its first check needs attention the
// way any pending monitor does.
export function routeAgentTone(state: RouteState): AgentTargetTone {
  if (isRouteAbnormal(state)) return 'abnormal'
  if (state === 'pending') return 'attention'
  return 'healthy'
}

export function agentTargetTone(row: TargetAgentStatusRow): AgentTargetTone {
  if (row.execution_state === 'disabled') return 'inactive'
  if (
    row.fault_state === 'faulted'
    || row.fault_state === 'confirming'
    || row.probe_state === 'failed'
    || row.execution_state === 'permission_blocked'
    || row.execution_state === 'target_blocked'
    || row.execution_state === 'unsupported'
  ) {
    return 'abnormal'
  }
  if (
    row.execution_state === 'agent_offline'
    || row.execution_state === 'pending'
    || row.execution_state === 'unassigned'
    || row.probe_state === 'stale'
    || row.probe_state === 'no_data'
  ) {
    return 'attention'
  }
  return 'healthy'
}

// Route monitors (kind "trace") take their tone from the route summary rather
// than from the availability fields, which the server leaves empty for them.
// Pass `routes` (target id → summary) and `now` to get that; without them a
// route row reads as waiting for its first check, never as abnormal.
export function buildAgentTargetViews(
  targets: TargetStatusRow[],
  agentID: string,
  groups: MonitorGroup[],
  routes?: Map<string, RouteTargetSummary>,
  now: number = Date.now(),
): AgentTargetView[] {
  if (!agentID) return []
  const groupNames = new Map(groups.map((group) => [group.id, group.name]))
  const views: AgentTargetView[] = []

  for (const target of targets) {
    const agent = target.agents.find((candidate) => candidate.agent_id === agentID)
    if (!agent) continue
    const groupName = groupNames.get(target.group_id) || target.group_id
    if (isRouteTarget(target)) {
      const summary = routes?.get(target.target_id)?.agents.find((row) => row.agent_id === agentID) ?? null
      const state: RouteState = !target.enabled
        ? 'pending'
        : summary ? routeAgentState(summary, now) : 'pending'
      views.push({
        target,
        agent,
        groupName,
        tone: target.enabled ? routeAgentTone(state) : 'inactive',
        route: { summary, state },
      })
      continue
    }
    views.push({
      target,
      agent,
      groupName,
      tone: agentTargetTone(agent),
    })
  }

  return views.sort((a, b) =>
    TONE_RANK[a.tone] - TONE_RANK[b.tone]
    || (a.target.name || a.target.target).localeCompare(b.target.name || b.target.target)
    || a.target.target_id.localeCompare(b.target.target_id),
  )
}

export function countAgentTargets(rows: AgentTargetView[]): AgentTargetSummary {
  const summary: AgentTargetSummary = {
    total: rows.length,
    abnormal: 0,
    attention: 0,
    healthy: 0,
    inactive: 0,
  }
  for (const row of rows) summary[row.tone]++
  return summary
}

export function defaultAgentHistoryTarget(rows: AgentTargetView[]): string {
  return rows[0]?.target.target_id || ''
}
