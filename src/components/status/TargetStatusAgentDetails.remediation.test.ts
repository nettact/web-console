import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'

// ensureServerInfo() -> api.serverInfo(); TargetStatusPerformance -> api.metricsSummary().
const apiMock = vi.hoisted(() => ({ serverInfo: vi.fn(), metricsSummary: vi.fn() }))
vi.mock('../../api', () => ({ api: apiMock }))

import type { Issue, TargetStatusRow } from '../../api'
import TargetStatusAgentDetails from './TargetStatusAgentDetails.vue'
import { notifications } from '../../notifications'
import { i18n } from '../../i18n'

const target: TargetStatusRow = {
  target_id: 'target-1',
  group_id: 'group-1',
  name: 'Public DNS',
  kind: 'dns',
  target: '1.1.1.1',
  enabled: true,
  display_state: 'blocked',
  applicable_agents: 1,
  affected_agents: 1,
  availability_rounds: 0,
  availability_ok_rounds: 0,
  signal_ids: [],
  incident_ids: [],
  agents: [
    {
      agent_id: 'agent-1',
      agent_name: 'Agent 1',
      agent_online: true,
      execution_state: 'permission_blocked',
      probe_state: 'not_applicable',
      fault_state: 'normal',
      reason_code: 'permission_blocked',
      missing_permissions: ['host.process.owner.read'],
      matched_selector: 'all',
      block_reason: '',
      availability_rounds: 0,
      availability_ok_rounds: 0,
    },
  ],
}

const issue = (extra: Partial<Issue> = {}): Issue => ({
  id: 'issue-1',
  site_id: 'site_default',
  agent_id: 'agent-1',
  agent_name: 'Agent 1',
  category: 'monitor',
  ref_id: 'target-1',
  monitor_name: 'Public DNS',
  reason: 'permission_blocked',
  missing_permissions: ['host.process.owner.read'],
  matched_selector: '',
  policy_hash: '',
  state: 'active',
  read: false,
  count: 1,
  first_seen_at: '2026-07-24T00:00:00Z',
  last_seen_at: '2026-07-24T00:00:00Z',
  resolved_at: null,
  remediation: { reason: 'permission_blocked', permissions_env: 'NETTACT_AGENT_PERMISSIONS=exact' },
  ...extra,
})

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/target-status', component: { template: '<div />' } },
      { path: '/target-status/:targetId/agents/:agentId/history', component: { template: '<div />' } },
      { path: '/incidents', component: { template: '<div />' } },
    ],
  })
}

async function mountAndOpen() {
  const router = makeRouter()
  await router.push('/target-status')
  await router.isReady()
  const wrapper = mount(TargetStatusAgentDetails, {
    props: { target },
    global: { plugins: [router, i18n], stubs: { teleport: true } },
  })
  await wrapper.get('.chip.is-interactive').trigger('click')
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  apiMock.serverInfo.mockReset().mockResolvedValue({ listen: { desktop: false }, os: 'linux' })
  apiMock.metricsSummary.mockReset().mockResolvedValue(null)
})

afterEach(() => {
  notifications.issues = []
})

describe('TargetStatusAgentDetails env-line selection', () => {
  it('uses the env line from the active issue whose ref_id matches this exact target', async () => {
    notifications.issues = [issue({ remediation: { reason: 'permission_blocked', permissions_env: 'NETTACT_AGENT_PERMISSIONS=exact' } })]
    const wrapper = await mountAndOpen()

    const dialog = wrapper.get('[role="dialog"]')
    expect(dialog.text()).toContain('NETTACT_AGENT_PERMISSIONS=exact')
    expect(wrapper.find('[role="tab"]').exists()).toBe(true)
  })

  it('never borrows another target or a resolved issue env line; falls back to generic guidance', async () => {
    notifications.issues = [
      // Active, same agent, but a DIFFERENT target — its env is a whole-policy line
      // that may omit the clicked permission, so it must NOT be used.
      issue({ id: 'other', ref_id: 'target-2', remediation: { reason: 'permission_blocked', permissions_env: 'NETTACT_AGENT_PERMISSIONS=WRONG' } }),
      // Exact target but resolved — stale, so also ignored.
      issue({ id: 'stale', state: 'resolved', resolved_at: '2026-07-24T01:00:00Z', remediation: { reason: 'permission_blocked', permissions_env: 'NETTACT_AGENT_PERMISSIONS=STALE' } }),
    ]
    const wrapper = await mountAndOpen()

    const dialog = wrapper.get('[role="dialog"]')
    expect(dialog.text()).not.toContain('WRONG')
    expect(dialog.text()).not.toContain('STALE')
    expect(dialog.text()).toContain('cannot be generated')
    // Generic fallback: no code block and no run-mode snippet tabs.
    expect(wrapper.find('pre').exists()).toBe(false)
    expect(wrapper.find('[role="tab"]').exists()).toBe(false)
  })
})
