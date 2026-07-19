import { describe, expect, it } from 'vitest'
import type { TargetStatusRow } from '../api'
import { countStatuses } from './targetStatusPage'

describe('unknown target display states', () => {
  it('does not crash the site summary and treats the target as abnormal', () => {
    const row = {
      target_id: 'future', group_id: 'group', name: 'Future', kind: 'icmp', target: '1.1.1.1', enabled: true,
      display_state: 'future_server_state', applicable_agents: 0, affected_agents: 0, active_condition_count: 0,
      rule_ids: [], alert_ids: [], incident_ids: [], agents: [],
    } as unknown as TargetStatusRow

    const counts = countStatuses([row])
    expect(counts.total).toBe(1)
    expect(counts.abnormal).toBe(1)
  })
})

