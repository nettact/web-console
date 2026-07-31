import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'

const apiMock = vi.hoisted(() => ({
  monitorGroups: vi.fn(),
  agentGroups: vi.fn(),
  targetStatuses: vi.fn(),
  metrics: vi.fn(),
  metricsSummary: vi.fn(),
  agentStatusHistory: vi.fn(),
  agent: vi.fn(),
  listSeries: vi.fn(),
}))
vi.mock('../api', () => ({ api: apiMock }))

import TargetStatus from './TargetStatus.vue'
import { agentStatus } from '../agentStatus'
import { targetStatus } from '../targetStatus'
import { i18n } from '../i18n'

const statusRow = {
  target_id: 'target-1',
  group_id: 'group-1',
  name: 'Public DNS',
  kind: 'dns',
  target: '1.1.1.1',
  enabled: true,
  display_state: 'faulted' as const,
  applicable_agents: 1,
  affected_agents: 1,
  worst_severity: 'critical' as const,
  last_observed_at: '2026-07-18T05:00:00Z',
  availability_24h: 0.92,
  signal_ids: ['signal-1'],
  incident_ids: ['incident-1'],
  agents: [{
    agent_id: 'agent-1',
    agent_name: 'Taipei NUC',
    agent_online: true,
    execution_state: 'collecting' as const,
    probe_state: 'failed' as const,
    fault_state: 'faulted' as const,
    reason_code: 'fault_confirmed' as const,
    missing_permissions: [],
    matched_selector: 'all-agents',
    block_reason: '',
    last_value: 2500,
    last_metric_kind: 'probe.dns.duration_ms',
    last_unit: 'ms',
    last_observed_at: '2026-07-18T05:00:00Z',
    availability_24h: 0.92,
    fault: {
      signal_id: 'signal-1',
      incident_id: 'incident-1',
      severity: 'critical',
      title: '「Public DNS」的 DNS 探测失败',
      observed_at: '2026-07-18T04:55:00Z',
      confirmed_at: '2026-07-18T04:58:00Z',
    },
  }],
}

beforeEach(() => {
  localStorage.clear()
  apiMock.monitorGroups.mockResolvedValue([{
    id: 'group-1', site_id: 'site_default', name: 'Core Network', is_default: true,
    merge_enabled: true, all_agents: true, agent_group_ids: [],
  }, {
    id: 'group-empty', site_id: 'site_default', name: 'Empty Group', is_default: false,
    merge_enabled: false, all_agents: false, agent_group_ids: [],
  }])
  apiMock.agentGroups.mockResolvedValue([])
  apiMock.metrics.mockReset().mockResolvedValue([])
  apiMock.metricsSummary.mockReset().mockResolvedValue({ window_seconds: 7200, kinds: {} })
  apiMock.agentStatusHistory.mockReset().mockResolvedValue([])
  apiMock.agent.mockReset().mockResolvedValue({
    id: 'agent-1',
    display_name: 'Taipei NUC',
    hostname: 'taipei-nuc',
    platform: 'windows',
  })
  apiMock.listSeries.mockReset().mockResolvedValue([])
  agentStatus.generatedAt = '2026-07-18T05:00:01Z'
  agentStatus.agents = [{
    id: 'agent-1',
    display_name: 'Taipei NUC',
    hostname: 'taipei-nuc',
    platform: 'windows',
    agent_version: '0.1.0',
    status: 'abnormal',
    presence: 'online',
    status_since: '2026-07-18T04:55:00Z',
    last_seen_at: '2026-07-18T05:00:00Z',
    first_connected_at: '2026-07-01T00:00:00Z',
    last_disconnect_kind: '',
    connectivity_alerts_muted: false,
    groups: [],
    firing_faults: 1,
    active_issues: 0,
    connectivity_alert: null,
    resources: { cpu: null, memory: null, disk: null, net: null, load: null, uptime: null },
    created_at: '2026-07-01T00:00:00Z',
  }]
  agentStatus.loaded = true
  agentStatus.stale = false
  agentStatus.error = ''
  targetStatus.generatedAt = '2026-07-18T05:00:01Z'
  targetStatus.targets = [statusRow]
  targetStatus.loaded = true
  targetStatus.stale = false
  targetStatus.error = ''
})

describe('group-centric target-status page', () => {
  it('restores stable target/Agent deep links and renders the group hierarchy', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/target-status', component: TargetStatus },
        { path: '/agents', component: { template: '<div />' } },
        { path: '/monitoring/:id/edit', component: { template: '<div />' } },
        { path: '/monitoring/groups/:id/edit', component: { template: '<div />' } },
        { path: '/monitoring/new', component: { template: '<div />' } },
        { path: '/incidents', component: { template: '<div />' } },
      ],
    })
    await router.push('/target-status?target=target-1&agent=agent-1')
    await router.isReady()

    const wrapper = mount(TargetStatus, { global: { plugins: [router, i18n] } })
    await flushPromises()

    expect(wrapper.text()).toContain('Core Network')
    expect(wrapper.text()).toContain('Public DNS')
    expect(wrapper.text()).toContain('Taipei NUC')
    expect(wrapper.text()).toContain('Empty Group')
    // The global board and selected-target workspace show the same authoritative ratio.
    expect(wrapper.get('.board-availability').text()).toBe('92%')
    expect(wrapper.get('.target-summary-grid').text()).toContain(i18n.global.t('targetStatus.availability24h'))
    expect(wrapper.get('.target-summary-grid').text()).toContain('92%')
    expect(router.currentRoute.value.query).toEqual({ view: 'targets', target: 'target-1', agent: 'agent-1' })
    expect(wrapper.findAll('.target-board-group')).toHaveLength(2)
    expect(wrapper.find('.target-detail-workspace').exists()).toBe(true)
    expect(wrapper.find('a[href="/monitoring/target-1/edit"]').exists()).toBe(false)
    expect(wrapper.find('a[href="/monitoring/new?group=group-1"]').exists()).toBe(false)
    await wrapper.get('.workspace-back').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.target).toBeUndefined()
    expect(wrapper.find('.target-detail-workspace').exists()).toBe(false)
    expect(wrapper.find('.target-board-row').exists()).toBe(true)
    expect(wrapper.get('.view-switch button.active').text()).toBe(i18n.global.t('targetStatus.viewTargets'))
  })

  it('keeps the global status board visible while target history opens in an inline workspace', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/target-status', component: TargetStatus },
        { path: '/monitoring/groups/:id/edit', component: { template: '<div />' } },
        { path: '/monitoring/new', component: { template: '<div />' } },
        { path: '/incidents', component: { template: '<div />' } },
      ],
    })
    await router.push('/target-status?view=targets')
    await router.isReady()

    const wrapper = mount(TargetStatus, { global: { plugins: [router, i18n] } })
    await flushPromises()

    expect(wrapper.findAll('.target-board-group')).toHaveLength(2)
    expect(wrapper.find('.summary-grid').exists()).toBe(true)
    expect(wrapper.find('.target-detail-workspace').exists()).toBe(false)

    await wrapper.get('.target-board-row').trigger('click')
    await flushPromises()
    expect(wrapper.find('.target-detail-workspace').exists()).toBe(true)
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.find('.drawer-backdrop').exists()).toBe(false)
    expect(wrapper.get('.workspace-back').text()).toContain(i18n.global.t('targetStatus.backToTargetBoard'))
    expect(wrapper.find('.target-board-row').exists()).toBe(true)
    expect(wrapper.find('.summary-grid').exists()).toBe(true)

    await wrapper.get('.priority-agent-list button').trigger('click')
    await flushPromises()
    expect(wrapper.get('.target-tabs button.active').text()).toBe(i18n.global.t('targetStatus.targetTabHistory'))
    expect(router.currentRoute.value.query).toEqual({
      view: 'targets',
      target: 'target-1',
      agent: 'agent-1',
      ttab: 'history',
    })
    expect(apiMock.listSeries).toHaveBeenCalledWith('agent-1')
  })

  it('shows a truthful initial error instead of empty group or healthy summaries', async () => {
    targetStatus.targets = []
    targetStatus.loaded = false
    targetStatus.error = 'offline'
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/target-status', component: TargetStatus },
        { path: '/monitoring/groups/:id/edit', component: { template: '<div />' } },
        { path: '/monitoring/new', component: { template: '<div />' } },
      ],
    })
    await router.push('/target-status')
    await router.isReady()

    const wrapper = mount(TargetStatus, { global: { plugins: [router, i18n] } })
    await flushPromises()

    expect(wrapper.text()).toContain(i18n.global.t('targetStatus.errorBanner'))
    expect(wrapper.text()).not.toContain('Core Network')
    expect(wrapper.find('.summary-grid').exists()).toBe(false)
  })

  it('opens the Agent workbench by default and reaches history in one action', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/target-status', component: TargetStatus },
        { path: '/monitoring/groups/:id/edit', component: { template: '<div />' } },
        { path: '/monitoring/new', component: { template: '<div />' } },
      ],
    })
    await router.push('/target-status')
    await router.isReady()

    const wrapper = mount(TargetStatus, { global: { plugins: [router, i18n] } })
    await flushPromises()

    expect(wrapper.get('.view-switch button.active').text()).toBe(i18n.global.t('targetStatus.viewAgents'))
    expect(wrapper.text()).toContain('Taipei NUC')
    expect(router.currentRoute.value.query).toEqual({ view: 'agents', agent: 'agent-1' })

    await wrapper.get('.agent-history-shortcut').trigger('click')
    await flushPromises()

    expect(wrapper.get('.agent-tabs button.active').text()).toBe(i18n.global.t('targetStatus.agentTabHistory'))
    expect(router.currentRoute.value.query).toEqual({
      view: 'agents',
      agent: 'agent-1',
      tab: 'history',
    })
    expect(apiMock.agentStatusHistory).toHaveBeenCalledWith('agent-1')
  })

  it('restores a target-probe history workspace from URL state', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/target-status', component: TargetStatus },
        { path: '/monitoring/groups/:id/edit', component: { template: '<div />' } },
        { path: '/monitoring/new', component: { template: '<div />' } },
      ],
    })
    await router.push('/target-status?view=agents&agent=agent-1&tab=history&history=target&target=target-1')
    await router.isReady()

    const wrapper = mount(TargetStatus, { global: { plugins: [router, i18n] } })
    await flushPromises()

    expect(wrapper.get('.view-switch button.active').text()).toBe(i18n.global.t('targetStatus.viewAgents'))
    expect(wrapper.get('.agent-tabs button.active').text()).toBe(i18n.global.t('targetStatus.agentTabHistory'))
    expect(wrapper.get('.history-mode-switch button.active').text()).toBe(i18n.global.t('targetStatus.targetProbeHistory'))
    expect((wrapper.get('.target-history-picker select').element as HTMLSelectElement).value).toBe('target-1')
    expect(router.currentRoute.value.query).toEqual({
      view: 'agents',
      agent: 'agent-1',
      tab: 'history',
      history: 'target',
      target: 'target-1',
    })
  })
})
