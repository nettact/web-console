import { describe, expect, it } from 'vitest'
import type { Issue } from './api'
import { issueLink } from './notifications'

const issue = (extra: Partial<Issue> = {}): Issue => ({
  id: 'issue-1',
  site_id: 'site_default',
  agent_id: 'agent-1',
  agent_name: 'Agent 1',
  category: 'monitor',
  ref_id: 'target-1',
  monitor_name: 'Public DNS',
  reason: 'permission_blocked',
  missing_permissions: [],
  matched_selector: '',
  policy_hash: '',
  state: 'active',
  read: false,
  count: 1,
  first_seen_at: '2026-07-18T00:00:00Z',
  last_seen_at: '2026-07-18T00:00:00Z',
  resolved_at: null,
  ...extra,
})

describe('notification target-status links', () => {
  it('uses stable target and Agent ids without legacy view or mon: query values', () => {
    expect(issueLink(issue())).toEqual({
      path: '/target-status',
      query: { target: 'target-1', agent: 'agent-1' },
    })
  })

  it('keeps non-monitor issues on the Agent page', () => {
    expect(issueLink(issue({ monitor_name: '', ref_id: '' }))).toEqual({
      path: '/agents',
      query: { agent: 'agent-1' },
    })
  })
})

