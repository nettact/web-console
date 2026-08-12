import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'

const apiMock = vi.hoisted(() => ({ agent: vi.fn(), listSeries: vi.fn(), metrics: vi.fn(), metricsSummary: vi.fn() }))
vi.mock('../../api', () => ({ api: apiMock }))

import TargetStatusAgentDetails from './TargetStatusAgentDetails.vue'
import TargetStatusHistory from './TargetStatusHistory.vue'
import { i18n } from '../../i18n'

const target = {
  target_id: 'target-1', group_id: 'group-1', name: 'Public DNS', kind: 'dns', target: '1.1.1.1', enabled: true,
  display_state: 'healthy' as const, applicable_agents: 1, affected_agents: 0,
  availability_rounds: 0, availability_ok_rounds: 0,
  signal_ids: [], incident_ids: [],
  agents: [{
    agent_id: 'agent-1', agent_name: 'Agent 1', agent_online: true,
    execution_state: 'collecting' as const, probe_state: 'healthy' as const, fault_state: 'normal' as const,
    reason_code: 'ok' as const, missing_permissions: [], matched_selector: 'all', block_reason: '',
    availability_rounds: 0, availability_ok_rounds: 0,
  }],
}

const agent = {
  id: 'agent-1', site_id: 'site_default', display_name: 'Agent 1', hostname: 'agent-1', platform: 'linux',
  agent_version: '1.0.0', status: 'online', supported: [], granted: [], effective: [], policy_source: 'default',
  policy_hash: '', last_seen_at: '2026-07-18T00:00:00Z', created_at: '2026-07-18T00:00:00Z',
}

beforeEach(() => {
  apiMock.agent.mockReset().mockResolvedValue(agent)
  apiMock.metrics.mockReset().mockResolvedValue([])
  apiMock.metricsSummary.mockReset().mockResolvedValue({ window_seconds: 7200, kinds: {} })
  apiMock.listSeries.mockReset().mockResolvedValue([
    { kind: 'probe.dns.ok', target: '1.1.1.1', layer: 'network', unit: 'bool', monitor_id: 'target-1' },
    { kind: 'probe.dns.duration_ms', target: '1.1.1.1', layer: 'network', unit: 'ms', monitor_id: 'target-1' },
    { kind: 'probe.dns.ok', target: 'other', layer: 'network', unit: 'bool', monitor_id: 'other-target' },
  ])
})

describe('Agent-level target history drill-down', () => {
  it('opens the Agent history workspace when the Agent card is clicked', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/target-status', component: { template: '<div />' } },
        { path: '/incidents', component: { template: '<div />' } },
      ],
    })
    await router.push('/target-status')
    await router.isReady()
    const wrapper = mount(TargetStatusAgentDetails, {
      props: { target },
      global: { plugins: [router, i18n] },
    })

    await wrapper.get('.agent-card').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/target-status')
    expect(router.currentRoute.value.query).toEqual({
      view: 'targets',
      agent: 'agent-1',
      target: 'target-1',
      ttab: 'history',
    })
    expect(wrapper.find('[role="tab"]').exists()).toBe(false)
    expect(wrapper.text()).toContain(i18n.global.t('targetStatus.statusLabel'))
    expect(wrapper.text()).toContain(i18n.global.t('targetStatus.context.collecting'))
  })

  it('loads series for only the selected Agent and scopes them by stable target id', async () => {
    const wrapper = mount(TargetStatusHistory, {
      props: { target, agentId: 'agent-1', rangeSec: 7 * 86400 },
      global: {
        plugins: [i18n],
        stubs: {
          TargetAcrossAgents: {
            props: ['probers', 'monitorId', 'restrictToProbers', 'rangeSec'],
            template: '<div data-test="charts">{{ probers.length }}:{{ monitorId }}:{{ probers[0].series.length }}:{{ rangeSec }}</div>',
          },
        },
      },
    })
    await flushPromises()

    expect(apiMock.agent).toHaveBeenCalledTimes(1)
    expect(apiMock.agent).toHaveBeenCalledWith('agent-1')
    expect(apiMock.listSeries).toHaveBeenCalledTimes(1)
    expect(apiMock.listSeries).toHaveBeenCalledWith('agent-1')
    expect(wrapper.get('[data-test="charts"]').text()).toBe('1:target-1:2:604800')

    const chartElement = wrapper.get('[data-test="charts"]').element
    await wrapper.setProps({ target: { ...target, name: 'Public DNS (refreshed status)' } })
    await flushPromises()

    // The authoritative current-status poll replaces the target object, but the
    // stable target/Agent ids mean historical series and chart DOM stay intact.
    expect(apiMock.agent).toHaveBeenCalledTimes(1)
    expect(apiMock.listSeries).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-test="charts"]').element).toBe(chartElement)
  })
})
