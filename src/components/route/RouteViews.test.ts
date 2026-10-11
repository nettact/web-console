import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import en from '../../locales/en'
import type { RouteAgentView, RouteChange, RouteChangeDetail, RouteOverview, RoutePathView, TargetStatusRow } from '../../api'
import { buildRouteTargetView } from '../../lib/routeStatus'
import RoutePathPanel from './RoutePathPanel.vue'
import RouteChangeTimeline from './RouteChangeTimeline.vue'
import RouteTargetOverview from './RouteTargetOverview.vue'

const apiMock = vi.hoisted(() => ({
  targetRoute: vi.fn(),
  targetRouteChanges: vi.fn(),
  routeChange: vi.fn(),
}))
vi.mock('../../api', () => ({ api: apiMock }))

const asA = { asn: 64500, as_name: 'Access Net', as_country: 'US' }
const asB = { asn: 64501, as_name: 'Backbone', as_country: 'US' }
const asC = { asn: 64502, as_name: 'Other Backbone', as_country: 'DE' }
const asD = { asn: 64503, as_name: 'Dest', as_country: 'US' }

function pathView(id: number, middle: typeof asB): RoutePathView {
  return {
    path_id: id,
    as_path: [asA, middle, asD],
    reached: true,
    hops: [
      { ttl: 1, timeout: false, responders: [{ ip: '192.168.1.1', hostname: 'router', asn: null, as_name: '', as_country: '', prefix: '' }] },
      { ttl: 2, timeout: true, responders: [] },
      { ttl: 3, timeout: false, responders: [{ ip: '10.0.0.3', hostname: '', asn: asA.asn, as_name: asA.as_name, as_country: 'US', prefix: '' }] },
      { ttl: 4, timeout: false, responders: [{ ip: id === 1 ? '20.0.0.1' : '30.0.0.1', hostname: '', asn: middle.asn, as_name: middle.as_name, as_country: middle.as_country, prefix: '' }] },
      { ttl: 5, timeout: false, responders: [{ ip: '40.0.0.1', hostname: 'dest', asn: asD.asn, as_name: asD.as_name, as_country: 'US', prefix: '' }] },
    ],
  }
}

const active: RouteAgentView = {
  agent_id: 'a1',
  agent_name: 'Home',
  status: 'active',
  last_run_at: '2026-10-10T10:00:00Z',
  current: {
    id: 9, agent_id: 'a1', path_id: 2, as_path: [asA, asC, asD],
    start_at: '2026-10-07T06:00:00Z', end_at: '2026-10-10T10:00:00Z',
    run_count: 450, deviation_count: 0, dest_ip: '40.0.0.1', local_asn: asA.asn,
    rtt: { count: 450, min_ms: 10, max_ms: 80, p50_ms: 22.4, p95_ms: 41 },
    reached_ratio: 0.99, variants: [],
  },
  path: pathView(2, asC),
}
const old: RouteAgentView = {
  agent_id: 'a2', agent_name: 'Office', status: 'agent_upgrade_required', last_run_at: null, current: null, path: null,
}
const change: RouteChange = {
  id: 77, monitor_id: 't1', agent_id: 'a1', agent_name: 'Home', kind: 'route', segment: 'isp_backbone',
  diverge_ttl: 4, confirmed_at: '2026-10-07T06:30:00Z', from_epoch_id: 8, to_epoch_id: 9,
  from_as_path: [asA, asB, asD], to_as_path: [asA, asC, asD],
  rtt_before: { count: 100, min_ms: 9, max_ms: 50, p50_ms: 18, p95_ms: 30 },
  rtt_after: { count: 30, min_ms: 10, max_ms: 80, p50_ms: 30.2, p95_ms: 41 },
}
const detail: RouteChangeDetail = {
  change, before: pathView(1, asB), after: pathView(2, asC), before_run: null, after_run: null,
}

const i18n = () => createI18n({ legacy: false, locale: 'en', messages: { en } })

beforeEach(() => {
  vi.clearAllMocks()
  apiMock.targetRouteChanges.mockResolvedValue({ changes: [change] })
  apiMock.routeChange.mockResolvedValue(detail)
})

async function renderPath(overview: RouteOverview, agentId = '') {
  apiMock.targetRoute.mockResolvedValue(overview)
  const page = mount(RoutePathPanel, { props: { targetId: 't1', agentId }, global: { plugins: [i18n()] } })
  await flushPromises()
  return page
}

describe('RoutePathPanel', () => {
  it('shows the current route of the first Agent that has one', async () => {
    const page = await renderPath({ asn_db_version: '2026-10-01', agents: [old, active] })
    expect(page.get('.agent-switch button.active').text()).toContain('Home')
    expect(page.text()).toContain('AS64502')
    expect(page.text()).toContain('Other Backbone')
    expect(page.text()).toContain('22 ms')
    expect(page.text()).toContain('99%')
    expect(page.text()).toContain('3d 4h')
    expect(page.findAll('table.route-hops tbody tr')).toHaveLength(5)
    expect(page.get('table.route-hops tbody tr:nth-child(2) .star').text()).toBe('*')
    // Path only: the change history is a separate view.
    expect(apiMock.targetRouteChanges).not.toHaveBeenCalled()
  })

  it('honours a requested Agent and reports a switch', async () => {
    const page = await renderPath({ asn_db_version: '', agents: [active, old] }, 'a2')
    expect(page.get('.agent-switch button.active').text()).toContain('Office')
    expect(page.text()).toContain(en.route.status.agent_upgrade_required)
    expect(page.text()).toContain(en.route.statusExplain.agent_upgrade_required)
    expect(page.text()).toContain(en.route.noData)
    await page.findAll('.agent-switch button')[0].trigger('click')
    expect(page.emitted('update:agentId')?.[0]).toEqual(['a1'])
  })

  it('says so when no Agent runs the monitor', async () => {
    const page = await renderPath({ asn_db_version: '', agents: [] })
    expect(page.text()).toContain(en.route.noAgents)
  })
})

describe('RouteChangeTimeline', () => {
  it('labels a change by kind and segment in the info tone, with the RTT shift, and opens the comparison', async () => {
    const page = mount(RouteChangeTimeline, {
      props: { targetId: 't1', agentId: 'a1' },
      global: { plugins: [i18n()] },
    })
    await flushPromises()
    expect(apiMock.targetRouteChanges).toHaveBeenCalledWith('t1', expect.objectContaining({ agent_id: 'a1', limit: 20 }))
    const item = page.get('.change-item')
    expect(item.get('.tag-info').text()).toBe(en.route.kind.route)
    expect(item.text()).toContain(en.route.segment.isp_backbone)
    expect(item.text()).toContain('Diverges at hop 4')
    expect(item.text()).toContain('+12 ms')
    expect(item.find('.is-removed').text()).toContain('AS64501')
    expect(item.find('.is-added').text()).toContain('AS64502')
    expect(page.find('.badge.warn').exists()).toBe(false)

    await item.get('button').trigger('click')
    await flushPromises()
    expect(apiMock.routeChange).toHaveBeenCalledWith(77)
    const highlighted = page.findAll('.route-change-detail tr.differs th')
    expect(highlighted.map((th) => th.text())).toEqual(['4', '4'])
  })

  it('lists every Agent when unfiltered and offers an Agent filter', async () => {
    const page = mount(RouteChangeTimeline, {
      props: {
        targetId: 't1',
        agents: [{ agent_id: 'a1', agent_name: 'Home' }, { agent_id: 'a2', agent_name: 'Office' }],
        showAgent: true,
      },
      global: { plugins: [i18n()] },
    })
    await flushPromises()
    expect(apiMock.targetRouteChanges).toHaveBeenCalledWith('t1', expect.objectContaining({ agent_id: undefined }))
    expect(page.get('.change-agent').text()).toBe('Home')
    await page.get('.agent-filter select').setValue('a2')
    expect(page.emitted('update:agentId')?.[0]).toEqual(['a2'])
  })
})

describe('RouteTargetOverview', () => {
  it('shows each Agent’s route, not availability, and previews recent changes across Agents', async () => {
    const now = Date.parse('2026-10-11T12:00:00Z')
    const target = {
      target_id: 't1', group_id: 'g1', name: 'CDN route', kind: 'trace', target: 'cdn.example.test', enabled: true,
      display_state: 'no_data', applicable_agents: 2, affected_agents: 0, availability_rounds: 0,
      availability_ok_rounds: 0, signal_ids: [], incident_ids: [], agents: [],
    } as TargetStatusRow
    const view = buildRouteTargetView(target, {
      target_id: 't1',
      agents: [{
        agent_id: 'a1', agent_name: 'Home', status: 'active', last_run_at: '2026-10-11T11:55:00Z',
        current_since: '2026-10-11T09:00:00Z', as_path: [asA, asC, asD], dest_ip: '40.0.0.1',
        reached_ratio: 0.5, rtt_p50_ms: 31.6, last_change_at: '2026-10-11T09:00:00Z',
        changes_24h: 1, changes_7d: 4, interval_seconds: 600,
      }, {
        agent_id: 'a2', agent_name: 'Office', status: 'agent_upgrade_required', last_run_at: null,
        current_since: null, as_path: [], dest_ip: '', reached_ratio: null, rtt_p50_ms: null,
        last_change_at: null, changes_24h: 0, changes_7d: 0, interval_seconds: 600,
      }],
    }, now)
    const page = mount(RouteTargetOverview, { props: { view, now }, global: { plugins: [i18n()] } })
    await flushPromises()
    expect(page.text()).toContain(en.route.state.blocked) // roll-up
    expect(page.text()).toContain(en.route.state.changed) // Home
    expect(page.text()).toContain('3h') // held for
    expect(page.text()).toContain('32 ms')
    expect(page.text()).toContain('50%')
    expect(page.text()).toContain('3h ago')
    expect(page.text()).not.toMatch(/availability/i)
    expect(apiMock.targetRouteChanges).toHaveBeenCalledWith('t1', expect.objectContaining({ agent_id: undefined, limit: 5 }))
    expect(page.find('.load-more').exists()).toBe(false)
    const actions = page.findAll('.text-action')
    await actions[actions.length - 1].trigger('click')
    expect(page.emitted('openChanges')).toHaveLength(1)
  })
})
