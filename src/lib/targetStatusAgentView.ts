import type {
  MonitorGroup,
  TargetAgentStatusRow,
  TargetStatusRow,
} from '../api'

export type TargetStatusView = 'agents' | 'targets'
export type AgentWorkspaceTab = 'overview' | 'targets' | 'history' | 'metrics' | 'processes' | 'connections'
export type AgentHistoryMode = 'connectivity' | 'target' | 'fluctuations'
export type TargetWorkspaceTab = 'overview' | 'agents' | 'history'
export type AgentTargetTone = 'abnormal' | 'attention' | 'healthy' | 'inactive'

export interface AgentTargetView {
  target: TargetStatusRow
  agent: TargetAgentStatusRow
  groupName: string
  tone: AgentTargetTone
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
  return value === 'overview' || value === 'agents' || value === 'history'
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

export function buildAgentTargetViews(
  targets: TargetStatusRow[],
  agentID: string,
  groups: MonitorGroup[],
): AgentTargetView[] {
  if (!agentID) return []
  const groupNames = new Map(groups.map((group) => [group.id, group.name]))
  const views: AgentTargetView[] = []

  for (const target of targets) {
    const agent = target.agents.find((candidate) => candidate.agent_id === agentID)
    if (!agent) continue
    views.push({
      target,
      agent,
      groupName: groupNames.get(target.group_id) || target.group_id,
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
