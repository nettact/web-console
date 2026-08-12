import { describe, expect, it } from 'vitest'
import type { AgentGroup, DisplayState, MonitorGroup, TargetAgentStatusRow, TargetStatusRow } from '../api'
import {
  buildStatusGroups,
  countStatuses,
  isStatusFilter,
  matchesTargetSearch,
  statusBucket,
} from './targetStatusPage'

const agent = (id: string, name = id): TargetAgentStatusRow => ({
  agent_id: id,
  agent_name: name,
  agent_online: true,
  execution_state: 'collecting',
  probe_state: 'healthy',
  fault_state: 'normal',
  reason_code: 'ok',
  missing_permissions: [],
  matched_selector: 'all',
  block_reason: '',
  availability_rounds: 0,
  availability_ok_rounds: 0,
})

const target = (id: string, groupID: string, state: DisplayState, agents = [agent('agent-a')]): TargetStatusRow => ({
  target_id: id,
  group_id: groupID,
  name: `Target ${id}`,
  kind: id.includes('dns') ? 'dns' : 'icmp',
  target: `${id}.example.test`,
  enabled: state !== 'disabled',
  display_state: state,
  applicable_agents: agents.length,
  affected_agents: state === 'healthy' || state === 'disabled' ? 0 : agents.length,
  availability_rounds: 0,
  availability_ok_rounds: 0,
  signal_ids: [],
  incident_ids: [],
  agents,
})

const group = (id: string, name: string, extra: Partial<MonitorGroup> = {}): MonitorGroup => ({
  id,
  site_id: 'site_default',
  name,
  is_default: false,
  merge_enabled: false,
  all_agents: true,
  agent_group_ids: [],
  ...extra,
})

const filters = { search: '', groupId: '', status: 'all' as const, agentId: '' }

describe('target-status page model', () => {
  it('uses explicit product buckets without treating disabled or unassigned as healthy', () => {
    expect(statusBucket('faulted')).toBe('abnormal')
    expect(statusBucket('stale')).toBe('attention')
    expect(statusBucket('unassigned')).toBe('attention')
    expect(statusBucket('healthy')).toBe('healthy')
    expect(statusBucket('disabled')).toBe('inactive')

    const counts = countStatuses([
      target('a', 'g', 'faulted'),
      target('b', 'g', 'stale'),
      target('c', 'g', 'healthy'),
      target('d', 'g', 'disabled'),
    ])
    expect(counts).toMatchObject({ total: 4, abnormal: 1, attention: 1, healthy: 1, inactive: 1 })
  })

  it('keeps configured empty groups, groups each target exactly once, and surfaces unknown group ids', () => {
    const views = buildStatusGroups(
      [group('healthy', 'Healthy'), group('empty', 'Empty'), group('bad', 'Bad', { is_default: true })],
      [target('ok', 'healthy', 'healthy'), target('alarm', 'bad', 'faulted'), target('orphan', 'missing', 'no_data')],
      [],
      filters,
    )

    expect(views.map((view) => view.id)).toEqual(['bad', 'missing', 'healthy', 'empty'])
    expect(views.find((view) => view.id === 'empty')?.targets).toEqual([])
    expect(views.find((view) => view.id === 'missing')?.orphaned).toBe(true)
    expect(views.flatMap((view) => view.allTargets.map((row) => row.target_id)).sort()).toEqual(['alarm', 'ok', 'orphan'])
  })

  it('filters by full state, summary bucket, group, search text, and stable Agent id', () => {
    const officeAgentGroups: AgentGroup[] = [{ id: 'ag-office', site_id: 'site_default', name: 'Office', agent_ids: ['agent-b'], created_at: '2026-07-18T00:00:00Z' }]
    const rows = [
      target('dns-alert', 'core', 'faulted', [agent('agent-a', 'Taipei NUC')]),
      target('icmp-ok', 'core', 'healthy', [agent('agent-b', 'Office Mini')]),
      target('disabled', 'service', 'disabled', []),
    ]
    const groups = [group('core', 'Core'), group('service', 'Service', { all_agents: false, agent_group_ids: ['ag-office'] })]

    expect(buildStatusGroups(groups, rows, officeAgentGroups, { ...filters, search: 'taipei' }).flatMap((view) => view.targets).map((row) => row.target_id)).toEqual(['dns-alert'])
    expect(buildStatusGroups(groups, rows, officeAgentGroups, { ...filters, status: 'abnormal' }).flatMap((view) => view.targets).map((row) => row.target_id)).toEqual(['dns-alert'])
    expect(buildStatusGroups(groups, rows, officeAgentGroups, { ...filters, groupId: 'service' }).flatMap((view) => view.targets).map((row) => row.target_id)).toEqual(['disabled'])
    expect(buildStatusGroups(groups, rows, officeAgentGroups, { ...filters, agentId: 'agent-b' }).flatMap((view) => view.targets).map((row) => row.target_id)).toEqual(['icmp-ok'])
    expect(matchesTargetSearch(rows[0], 'DNS-ALERT')).toBe(true)
  })

  it('accepts only clean-cut current query values', () => {
    expect(isStatusFilter('abnormal')).toBe(true)
    expect(isStatusFilter('probe_failed')).toBe(true)
    expect(isStatusFilter('all')).toBe(true)
    expect(isStatusFilter('view=agent')).toBe(false)
    expect(isStatusFilter('unknown-state')).toBe(false)
  })
})
