import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'

const apiMock = vi.hoisted(() => ({
  monitorGroups: vi.fn(),
  agentGroups: vi.fn(),
  targetStatuses: vi.fn(),
  targetRoute: vi.fn(),
  targetRouteChanges: vi.fn(),
  routeChange: vi.fn(),
  routeSummaries: vi.fn(),
  agentStatusHistory: vi.fn(),
  fluctuations: vi.fn(),
  metrics: vi.fn(),
  metricsSummary: vi.fn(),
  listSeries: vi.fn(),
  agent: vi.fn(),
}))
vi.mock('../api', () => ({ api: apiMock }))

import TargetStatus from './TargetStatus.vue'
import { agentStatus } from '../agentStatus'
import { targetStatus } from '../targetStatus'
import { routeSummaries } from '../routeSummaries'
import { i18n } from '../i18n'
import type { RouteAgentSummary, TargetAgentStatusRow, TargetStatusRow } from '../api'

const NOW = Date.parse('2026-10-11T12:00:00Z')
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()
const HOUR = 3600_000

function tagent(over: Partial<TargetAgentStatusRow> = {}): TargetAgentStatusRow {
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
    availability: 1,
    availability_rounds: 10,
    availability_ok_rounds: 10,
    ...over,
  }
}

const dnsRow: TargetStatusRow = {
  target_id: 'dns-1', group_id: 'group-1', name: 'Public DNS', kind: 'dns', target: '1.1.1.1', enabled: true,
  display_state: 'healthy', applicable_agents: 1, affected_agents: 0, availability: 1,
  availability_rounds: 10, availability_ok_rounds: 10, signal_ids: [], incident_ids: [], agents: [tagent()],
}
function traceRow(id: string, name: string): TargetStatusRow {
  return {
    target_id: id, group_id: 'group-1', name, kind: 'trace', target: `${id}.example.test`, enabled: true,
    display_state: 'no_data', applicable_agents: 1, affected_agents: 0,
    availability_rounds: 0, availability_ok_rounds: 0, signal_ids: [], incident_ids: [],
    agents: [tagent({ probe_state: 'no_data', reason_code: 'probe_no_data', availability: undefined, availability_rounds: 0, availability_ok_rounds: 0 })],
  }
}
function summary(over: Partial<RouteAgentSummary>): RouteAgentSummary {
  return {
    agent_id: 'agent-1', agent_name: 'Taipei NUC', status: 'active', last_run_at: iso(5 * 60_000),
    current_since: iso(26 * HOUR), as_path: [{ asn: 64500, as_name: 'Access', as_country: 'US' }, { asn: 64503, as_name: 'Dest', as_country: 'US' }],
    dest_ip: '192.0.2.1', reached_ratio: 1, rtt_p50_ms: 12, last_change_at: null,
    changes_24h: 0, changes_7d: 0, interval_seconds: 600, ...over,
  }
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/target-status', component: TargetStatus }],
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  localStorage.clear()
  apiMock.monitorGroups.mockResolvedValue([{
    id: 'group-1', site_id: 'site_default', name: 'Core Network', is_default: true,
    merge_enabled: true, all_agents: true, agent_group_ids: [],
  }])
  apiMock.agentGroups.mockResolvedValue([])
  apiMock.targetRoute.mockResolvedValue({ asn_db_version: '', agents: [] })
  apiMock.targetRouteChanges.mockResolvedValue({ changes: [] })
  apiMock.agentStatusHistory.mockResolvedValue([])
  apiMock.fluctuations.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 15 })
  apiMock.metrics.mockResolvedValue([])
  apiMock.metricsSummary.mockResolvedValue({ window_seconds: 7200, kinds: {} })
  apiMock.listSeries.mockResolvedValue([])
  agentStatus.generatedAt = iso(0)
  agentStatus.agents = [{
    id: 'agent-1', display_name: 'Taipei NUC', hostname: 'taipei-nuc', platform: 'linux', agent_version: '1.0.0',
    status: 'ok', presence: 'online', policy_source: 'default', status_since: iso(HOUR), last_seen_at: iso(0),
    first_connected_at: iso(48 * HOUR), last_disconnect_kind: '', connectivity_alerts_muted: false, groups: [],
    firing_faults: 0, active_issues: 0, connectivity_alert: null, probe_overload: null,
    resources: { cpu: null, memory: null, disk: null, net: null, load: null, uptime: null }, created_at: iso(48 * HOUR),
  }] as never
  agentStatus.loaded = true
  agentStatus.stale = false
  agentStatus.error = ''
  targetStatus.generatedAt = iso(0)
  targetStatus.timeRange = '24h'
  targetStatus.requestedTimeRange = '24h'
  targetStatus.targets = [dnsRow, traceRow('trace-cdn', 'CDN route'), traceRow('trace-office', 'Office route')]
  targetStatus.loaded = true
  targetStatus.stale = false
  targetStatus.error = ''
  routeSummaries.targets = [
    { target_id: 'trace-cdn', agents: [summary({ last_change_at: iso(2 * HOUR), changes_24h: 1, changes_7d: 3 })] },
    { target_id: 'trace-office', agents: [summary({ last_run_at: iso(3 * HOUR) })] },
  ]
  routeSummaries.loaded = true
  routeSummaries.now = NOW
})

describe('route monitors on the target view', () => {
  it('lists route monitors in their own section, out of the availability summary', async () => {
    const router = makeRouter()
    await router.push('/target-status?view=targets')
    await router.isReady()
    const wrapper = mount(TargetStatus, { global: { plugins: [router, i18n] } })
    await flushPromises()

    // Availability side: only the DNS target.
    expect(wrapper.get('.donut span').text()).toBe('1')
    expect(wrapper.findAll('.target-board-row')).toHaveLength(1)
    expect(wrapper.get('.target-board-row').text()).toContain('Public DNS')
    expect(wrapper.findAll('.bucket-card strong').map((el) => el.text())).toEqual(['0', '0', '1', '0'])

    // Route card: total, 24 h changes, and only the stale one as abnormal.
    const card = wrapper.get('.route-card')
    expect(card.get('strong').text()).toBe('2')
    expect(card.text()).toContain(i18n.global.t('targetStatus.routeSummaryChanges', { n: 1 }))
    expect(card.text()).toContain(i18n.global.t('targetStatus.routeSummaryAbnormal', { n: 1 }))

    const rows = wrapper.findAll('.route-board-row')
    expect(rows.map((r) => r.get('.board-target-identity strong').text())).toEqual(['Office route', 'CDN route'])
    expect(rows[0].text()).toContain(i18n.global.t('route.state.stale'))
    expect(rows[1].text()).toContain(i18n.global.t('route.state.changed'))
    expect(rows[1].get('.route-state').classes()).toContain('is-info')
    expect(rows[1].text()).toContain('AS64500')
    expect(rows[1].text()).toContain(`1${i18n.global.t('route.unit.d')} 2${i18n.global.t('route.unit.h')}`)
    expect(wrapper.find('.route-board-row .board-availability').exists()).toBe(false)

    // The abnormal bucket filter keeps only blocked/stale route monitors.
    await wrapper.get('.bucket-card.bad').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.route-board-row').map((r) => r.get('.board-target-identity strong').text())).toEqual(['Office route'])
    wrapper.unmount()
  })

  it('opens a route monitor on overview / path / changes and maps the old route tab', async () => {
    const router = makeRouter()
    await router.push('/target-status?view=targets&target=trace-cdn&ttab=route')
    await router.isReady()
    const wrapper = mount(TargetStatus, { global: { plugins: [router, i18n] } })
    await flushPromises()

    const tabs = wrapper.findAll('.target-detail-workspace .target-tabs button')
    expect(tabs.map((b) => b.text())).toEqual([
      i18n.global.t('targetStatus.routeTab.overview'),
      i18n.global.t('targetStatus.routeTab.path'),
      i18n.global.t('targetStatus.routeTab.changes'),
    ])
    expect(wrapper.get('.target-tabs button.active').text()).toBe(i18n.global.t('targetStatus.routeTab.overview'))
    expect(wrapper.find('.route-target-overview').exists()).toBe(true)
    expect(wrapper.find('.target-summary-grid').exists()).toBe(false)
    expect(router.currentRoute.value.query.ttab).toBeUndefined()

    await tabs[2].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.ttab).toBe('changes')
    expect(wrapper.find('.route-change-timeline').exists()).toBe(true)

    await wrapper.findAll('.target-detail-workspace .target-tabs button')[1].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.ttab).toBe('path')
    expect(apiMock.targetRoute).toHaveBeenCalledWith('trace-cdn')
    wrapper.unmount()
  })
})

describe('route monitors on the Agent view', () => {
  it('counts only blocked/stale route monitors as abnormal and surfaces recent changes', async () => {
    const router = makeRouter()
    await router.push('/target-status?view=agents&agent=agent-1')
    await router.isReady()
    const wrapper = mount(TargetStatus, { global: { plugins: [router, i18n] } })
    await flushPromises()

    expect(wrapper.get('.agent-row-status small').text())
      .toBe(i18n.global.t('targetStatus.abnormalTargetCount', { n: 1 }))
    const priority = wrapper.get('.priority-targets .priority-list')
    expect(priority.text()).toContain('Office route')
    expect(priority.text()).not.toContain('CDN route')
    const recent = wrapper.get('.recent-route-changes')
    expect(recent.text()).toContain('CDN route')
    expect(recent.text()).not.toContain('Office route')

    await recent.get('.priority-list button').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ view: 'targets', target: 'trace-cdn', ttab: 'changes', agent: 'agent-1' })
    expect(apiMock.targetRouteChanges).toHaveBeenCalledWith('trace-cdn', expect.objectContaining({ agent_id: 'agent-1' }))
    wrapper.unmount()
  })

  it('shows trace rows without availability badges and a route timeline in target history', async () => {
    const router = makeRouter()
    await router.push('/target-status?view=agents&agent=agent-1&tab=targets')
    await router.isReady()
    const wrapper = mount(TargetStatus, { global: { plugins: [router, i18n] } })
    await flushPromises()

    const routeRows = wrapper.findAll('.route-target-row')
    expect(routeRows).toHaveLength(2)
    for (const r of routeRows) {
      expect(r.find('.target-row-availability').exists()).toBe(false)
      expect(r.findAll('.pill')).toHaveLength(0)
      expect(r.find('.route-state').exists()).toBe(true)
    }

    await routeRows[1].get('.history-row-action').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ tab: 'history', history: 'target', target: 'trace-cdn' })
    expect(wrapper.find('.route-change-timeline').exists()).toBe(true)
    expect(apiMock.targetRouteChanges).toHaveBeenCalledWith('trace-cdn', expect.objectContaining({ agent_id: 'agent-1' }))
    wrapper.unmount()
  })
})
