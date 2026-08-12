import { describe, expect, it } from 'vitest'
import type { MonitorGroup, TargetAgentStatusRow, TargetStatusRow } from '../api'
import {
  agentTargetTone,
  buildAgentTargetViews,
  countAgentTargets,
  defaultAgentHistoryTarget,
  isAgentHistoryMode,
  isAgentWorkspaceTab,
  isTargetWorkspaceTab,
  isTargetStatusView,
} from './targetStatusAgentView'

function agent(over: Partial<TargetAgentStatusRow> = {}): TargetAgentStatusRow {
  return {
    agent_id: 'agent-1',
    agent_name: 'Taipei NUC',
    agent_online: true,
    execution_state: 'collecting',
    probe_state: 'healthy',
    fault_state: 'normal',
    reason_code: 'ok',
    missing_permissions: [],
    matched_selector: 'all',
    block_reason: '',
    ...over,
  }
}

function target(id: string, row: TargetAgentStatusRow, groupID = 'group-1'): TargetStatusRow {
  return {
    target_id: id,
    group_id: groupID,
    name: id,
    kind: 'icmp',
    target: `${id}.example.test`,
    enabled: true,
    display_state: 'healthy',
    applicable_agents: 1,
    affected_agents: 0,
    signal_ids: [],
    incident_ids: [],
    agents: [row],
  }
}

const groups: MonitorGroup[] = [{
  id: 'group-1',
  site_id: 'site_default',
  name: 'Core Network',
  is_default: true,
  merge_enabled: true,
  all_agents: true,
  agent_group_ids: [],
}]

describe('Agent-first target-status model', () => {
  it('keeps execution, probe and fault dimensions separate while assigning a scan tone', () => {
    expect(agentTargetTone(agent())).toBe('healthy')
    expect(agentTargetTone(agent({ probe_state: 'stale' }))).toBe('attention')
    expect(agentTargetTone(agent({ execution_state: 'permission_blocked' }))).toBe('abnormal')
    expect(agentTargetTone(agent({ fault_state: 'confirming' }))).toBe('abnormal')
    expect(agentTargetTone(agent({ execution_state: 'disabled', probe_state: 'not_applicable' }))).toBe('inactive')
  })

  it('builds an abnormal-first target list for one Agent and keeps group context', () => {
    const rows = buildAgentTargetViews([
      target('Healthy target', agent()),
      target('Offline target', agent({ execution_state: 'agent_offline', probe_state: 'no_data', reason_code: 'agent_offline' })),
      target('Faulted target', agent({ fault_state: 'faulted', reason_code: 'fault_confirmed' })),
      target('Other Agent', agent({ agent_id: 'agent-2' })),
    ], 'agent-1', groups)

    expect(rows.map((row) => row.target.name)).toEqual(['Faulted target', 'Offline target', 'Healthy target'])
    expect(rows[0].groupName).toBe('Core Network')
    expect(countAgentTargets(rows)).toEqual({
      total: 3,
      abnormal: 1,
      attention: 1,
      healthy: 1,
      inactive: 0,
    })
    expect(defaultAgentHistoryTarget(rows)).toBe(rows[0].target.target_id)
  })

  it('accepts only explicit URL state values', () => {
    expect(isTargetStatusView('agents')).toBe(true)
    expect(isTargetStatusView('target')).toBe(false)
    expect(isAgentWorkspaceTab('history')).toBe(true)
    expect(isAgentWorkspaceTab('metrics')).toBe(true)
    expect(isAgentWorkspaceTab('processes')).toBe(true)
    expect(isAgentWorkspaceTab('connections')).toBe(true)
    expect(isAgentWorkspaceTab('permissions')).toBe(false)
    expect(isAgentHistoryMode('target')).toBe(true)
    expect(isAgentHistoryMode('all')).toBe(false)
    expect(isTargetWorkspaceTab('agents')).toBe(true)
    expect(isTargetWorkspaceTab('metrics')).toBe(false)
  })
})
