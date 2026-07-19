import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'

const apiMock = vi.hoisted(() => ({ monitorGroups: vi.fn(), agentGroups: vi.fn(), targetStatuses: vi.fn(), metrics: vi.fn() }))
vi.mock('../api', () => ({ api: apiMock }))

import TargetStatus from './TargetStatus.vue'
import { targetStatus } from '../targetStatus'
import { i18n } from '../i18n'
import { TARGET_STATUS_EXPANSION_KEY } from '../lib/targetStatusExpansion'

const statusRow = {
  target_id: 'target-1',
  group_id: 'group-1',
  name: 'Public DNS',
  kind: 'dns',
  target: '1.1.1.1',
  enabled: true,
  display_state: 'alerting' as const,
  applicable_agents: 1,
  affected_agents: 1,
  worst_severity: 'critical' as const,
  last_observed_at: '2026-07-18T05:00:00Z',
  active_condition_count: 1,
  rule_ids: ['rule-1'],
  alert_ids: ['alert-1'],
  incident_ids: ['incident-1'],
  agents: [{
    agent_id: 'agent-1',
    agent_name: 'Taipei NUC',
    agent_online: true,
    execution_state: 'collecting' as const,
    probe_state: 'failed' as const,
    rule_state: 'alerting' as const,
    reason_code: 'alert_firing' as const,
    missing_permissions: [],
    matched_selector: 'all-agents',
    block_reason: '',
    last_value: 2500,
    last_metric_kind: 'probe.dns.duration_ms',
    last_unit: 'ms',
    last_observed_at: '2026-07-18T05:00:00Z',
    active_conditions: [],
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
  targetStatus.generatedAt = '2026-07-18T05:00:01Z'
  targetStatus.targets = [statusRow]
  targetStatus.loaded = true
  targetStatus.stale = false
  targetStatus.error = ''
})

describe('group-centric target-status page', () => {
  it('restores stable target/Agent deep links and renders the group hierarchy', async () => {
    // An explicit URL target must override a previously saved all-collapsed view.
    localStorage.setItem(TARGET_STATUS_EXPANSION_KEY, JSON.stringify({
      expandedGroupIds: [],
      expandedTargetId: '',
    }))
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
    expect(router.currentRoute.value.query).toEqual({ target: 'target-1', agent: 'agent-1' })
    expect(wrapper.findAll('.group-head[role="button"]')[0].attributes('aria-expanded')).toBe('true')
    const targetSummary = wrapper.get('.target-summary[role="button"]')
    expect(wrapper.find('a[href="/monitoring/target-1/edit"]').exists()).toBe(false)
    expect(wrapper.find('a[href="/monitoring/new?group=group-1"]').exists()).toBe(false)
    expect(wrapper.find('.expand-short').exists()).toBe(false)
    await targetSummary.find('.state-cell').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.target).toBeUndefined()
    expect(wrapper.find('.agent-details').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Agent 视图')
    expect(wrapper.text()).not.toContain('目标视图')
  })

  it('remembers group and target expansion while the whole group header toggles', async () => {
    localStorage.setItem(TARGET_STATUS_EXPANSION_KEY, JSON.stringify({
      expandedGroupIds: ['group-1', 'group-empty'],
      expandedTargetId: 'target-1',
    }))
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/target-status', component: TargetStatus },
        { path: '/monitoring/groups/:id/edit', component: { template: '<div />' } },
        { path: '/monitoring/new', component: { template: '<div />' } },
        { path: '/incidents', component: { template: '<div />' } },
      ],
    })
    await router.push('/target-status')
    await router.isReady()

    const wrapper = mount(TargetStatus, { global: { plugins: [router, i18n] } })
    await flushPromises()

    const heads = wrapper.findAll('.group-head[role="button"]')
    expect(heads).toHaveLength(2)
    expect(heads.every((head) => head.attributes('aria-expanded') === 'true')).toBe(true)
    expect(wrapper.find('.agent-details').exists()).toBe(true)

    // Collapsing a group that contains the selected target must survive the
    // next authoritative status object replacement.
    await heads[0].get('.group-facts').trigger('click')
    expect(heads[0].attributes('aria-expanded')).toBe('false')
    targetStatus.targets = [{ ...statusRow, last_observed_at: '2026-07-18T05:00:10Z' }]
    await flushPromises()
    expect(heads[0].attributes('aria-expanded')).toBe('false')
    expect(JSON.parse(localStorage.getItem(TARGET_STATUS_EXPANSION_KEY) || '{}').expandedGroupIds).not.toContain('group-1')

    // Any non-action area in the row toggles the group.
    await heads[1].get('.group-facts').trigger('click')
    expect(heads[1].attributes('aria-expanded')).toBe('false')
    let saved = JSON.parse(localStorage.getItem(TARGET_STATUS_EXPANSION_KEY) || '{}')
    expect(saved.expandedGroupIds).not.toContain('group-empty')

    await heads[1].get('.group-facts').trigger('click')
    expect(heads[1].attributes('aria-expanded')).toBe('true')

    // The management link is the sole exception and must not collapse its row.
    await heads[1].get('.group-actions a').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/monitoring/groups/group-empty/edit')
    saved = JSON.parse(localStorage.getItem(TARGET_STATUS_EXPANSION_KEY) || '{}')
    expect(saved.expandedGroupIds).toContain('group-empty')
    expect(saved.expandedTargetId).toBe('target-1')
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
})

