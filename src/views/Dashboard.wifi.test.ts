import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import en from '../locales/en'
import Dashboard from './Dashboard.vue'
import type { Agent, AgentInterfaces, Sample, StatusEvent, TargetStatusRow } from '../api'
import { targetStatus } from '../targetStatus'
import { dashboardLayoutPayload, dashboardLayoutPreset } from '../lib/dashboardLayout'

const apiMock = vi.hoisted(() => ({
  agents: vi.fn(),
  dashboardLayout: vi.fn(),
  updateDashboardLayout: vi.fn(),
  quota: vi.fn(),
  metrics: vi.fn(),
  metricsSummary: vi.fn(),
  latest: vi.fn(),
  listDevices: vi.fn(),
  agentStatusHistory: vi.fn(),
  agentInterfaces: vi.fn(),
  faultSignals: vi.fn(),
  agentMonitorStatus: vi.fn(),
  incidents: vi.fn(),
}))

vi.mock('../api', () => ({ api: apiMock }))

const baseAgent: Agent = {
  id: 'agent-1',
  site_id: 'site_default',
  display_name: 'Wi-Fi Agent',
  hostname: 'host-1',
  platform: 'darwin',
  agent_version: 'test',
  status: 'online',
  supported: ['network.wifi.status.read'],
  granted: ['network.wifi.status.read'],
  effective: ['network.wifi.status.read'],
  policy_source: 'default',
  policy_hash: 'test',
  last_seen_at: '2026-07-13T01:00:00Z',
  created_at: '2026-07-13T00:00:00Z',
  first_connected_at: '2026-07-13T00:00:00Z',
  last_disconnect_kind: '',
  connectivity_alerts_muted: false,
}

const connected: AgentInterfaces = {
  wifi: { state: 'ok', sampled_at: '2026-07-13T01:00:00Z', stale: false },
  interfaces: [{
    name: 'en0', addrs: ['192.168.1.2/24'], dns: [], up: true, is_wireless: true,
    updated_at: '2026-07-13T01:00:00Z',
    wifi: {
      state: 'connected', reason: 'permission', band: '5', channel: 36,
      signal_dbm: -65, quality_pct: 70, rx_mbps: null, tx_mbps: 866.7,
    },
  }],
}

let wrapper: VueWrapper | undefined

const professionalLayout = dashboardLayoutPayload(dashboardLayoutPreset('professional'))

async function render(
  ifaces: AgentInterfaces,
  agent: Agent = baseAgent,
  latest: Sample[] = [],
  history: StatusEvent[] = [],
  layout: unknown = professionalLayout,
) {
  apiMock.agents.mockResolvedValue([agent])
  apiMock.quota.mockResolvedValue({ used: 1, max: 10 })
  apiMock.metrics.mockResolvedValue([])
  apiMock.metricsSummary.mockResolvedValue({ window_seconds: 86400, kinds: {} })
  apiMock.latest.mockResolvedValue(latest)
  apiMock.listDevices.mockResolvedValue([])
  apiMock.agentStatusHistory.mockResolvedValue(history)
  apiMock.faultSignals.mockResolvedValue([])
  apiMock.agentMonitorStatus.mockResolvedValue([])
  apiMock.incidents.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 1, summary: { open: 0, opened_24h: 0, resolved_24h: 0, top_layer: '' } })
  apiMock.dashboardLayout.mockResolvedValue(layout)
  apiMock.updateDashboardLayout.mockImplementation(async (payload: unknown) => payload)
  apiMock.agentInterfaces.mockResolvedValue(ifaces)

  wrapper = mount(Dashboard, {
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })],
      stubs: {
        MetricChart: { template: '<div class="metric-chart-stub" />' },
        RouterLink: { template: '<a><slot /></a>' },
        Teleport: true,
      },
    },
  })
  await flushPromises()
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  targetStatus.targets = []
  vi.useFakeTimers()
  vi.clearAllMocks()
})

afterEach(() => {
  targetStatus.targets = []
  wrapper?.unmount()
  wrapper = undefined
  vi.useRealTimers()
})

describe('Dashboard network adapter list', () => {
  it('merges readable Wi-Fi values into the matching adapter row', async () => {
    const card = (await render(connected)).get('.interface-surface')
    expect(card.text()).toContain('Network adapter list')
    expect(card.text()).toContain('en0')
    expect(card.text()).toContain('(unknown network)')
    expect(card.text()).toContain('System permission required')
    expect(card.text()).toContain('-65 dBm')
    expect(card.text()).toContain('Fair')
    expect(card.text()).toContain('70%')
    expect(card.text()).toContain('— / 867 Mbps')
    expect(wrapper?.find('.wifi-surface').exists()).toBe(false)
  })

  it('clears stale categorical and numeric values when disconnected', async () => {
    const oldLatest: Sample[] = [{
      ts: '2026-07-13T00:00:00Z', kind: 'wifi.signal_dbm', target: 'en0',
      layer: 'wireless', value: -40, unit: 'dbm',
    }]
    const disconnected: AgentInterfaces = {
      wifi: { state: 'ok', sampled_at: '2026-07-13T01:00:00Z', stale: false },
      interfaces: [{
        ...connected.interfaces[0],
        wifi: {
          state: 'disconnected', ssid: 'stale-network', band: '5', channel: 36,
          signal_dbm: -40, quality_pct: 100, rx_mbps: 500, tx_mbps: 500,
        },
      }],
    }
    const card = (await render(disconnected, baseAgent, oldLatest)).get('.interface-surface')
    expect(card.text()).toContain('Disconnected')
    expect(card.text()).not.toContain('stale-network')
    expect(card.text()).not.toContain('-40 dBm')
    expect(card.find('.wifi-metrics').exists()).toBe(false)
  })

  it('distinguishes per-adapter permission failures from driver failures', async () => {
    const unreadable: AgentInterfaces = {
      wifi: { state: 'ok', sampled_at: '2026-07-13T01:00:00Z', stale: false },
      interfaces: [{
        ...connected.interfaces[0],
        wifi: {
          state: 'unreadable', reason: 'permission',
          signal_dbm: null, quality_pct: null, rx_mbps: null, tx_mbps: null,
        },
      }],
    }
    const card = (await render(unreadable)).get('.interface-surface')
    expect(card.text()).toContain('Unreadable')
    expect(card.text()).toContain('System permission required')
  })

  it('marks merged Wi-Fi details stale while the agent is offline', async () => {
    const card = (await render(connected, { ...baseAgent, status: 'offline' })).get('.interface-surface')
    expect(card.text()).toContain('Status expired')
    expect(card.text()).not.toContain('-65 dBm')
  })

  it('keeps ordinary adapters in the list without Wi-Fi-only empty states', async () => {
    const wired: AgentInterfaces = {
      wifi: { state: '', sampled_at: null, stale: true },
      interfaces: [{
        name: 'eth0', addrs: ['192.168.1.3/24'], dns: [], up: true, is_wireless: false,
        updated_at: '2026-07-13T01:00:00Z',
      }],
    }
    const card = (await render(wired, { ...baseAgent, effective: [] })).get('.interface-surface')
    expect(card.text()).toContain('eth0')
    expect(card.text()).toContain('Network adapter')
    expect(card.text()).not.toContain('Wi-Fi status not supported')
  })

  it('uses the wired default-route interface even while Wi-Fi is connected', async () => {
    vi.setSystemTime(new Date('2026-07-13T01:00:30Z'))
    const wiredDefault: AgentInterfaces = {
      wifi: { state: 'ok', sampled_at: '2026-07-13T01:00:00Z', stale: false },
      default_route: { gateway: '192.168.1.1', interface: 'Ethernet' },
      interfaces: [
        {
          name: 'Ethernet', addrs: ['192.168.1.3/24'], gateway: '192.168.1.1',
          dns: [], up: true, is_wireless: false, updated_at: '2026-07-13T01:00:00Z',
        },
        {
          ...connected.interfaces[0],
          gateway: '10.0.0.1',
          wifi: { ...connected.interfaces[0].wifi!, ssid: 'Connected but not default' },
        },
      ],
    }

    await render(wiredDefault)

    const node = wrapper!.findAll('.path-node')[1]
    expect(wrapper!.get('.path-card-head').text()).toContain('NETWORK PATH')
    expect(node.text()).toContain('Ethernet')
    expect(node.text()).toContain('Normal')
    expect(node.text()).not.toContain('192.168.1.1')
    expect(node.text()).not.toContain('Connected but not default')
    expect(wrapper!.get('.path-diagnosis').text()).not.toContain('default egress interface')
  })

  it('ignores a disconnected adapter holding a stale route to the same gateway', async () => {
    vi.setSystemTime(new Date('2026-07-13T01:00:30Z'))
    // The wired NIC owns default egress; the unplugged Wi-Fi adapter kept a
    // stale route to that same gateway. Joining the route by gateway address
    // named the down adapter and failed the whole path on a wired host.
    const staleWifiRoute: AgentInterfaces = {
      wifi: { state: 'ok', sampled_at: '2026-07-13T01:00:00Z', stale: false },
      default_route: { gateway: '192.168.66.1', interface: 'Ethernet' },
      interfaces: [
        {
          name: 'Ethernet', addrs: ['192.168.66.21/24'], gateway: '192.168.66.1',
          dns: [], up: true, is_wireless: false, updated_at: '2026-07-13T01:00:00Z',
        },
        {
          ...connected.interfaces[0],
          name: 'WLAN', up: false, gateway: '192.168.66.1',
          wifi: { ...connected.interfaces[0].wifi!, state: 'disconnected', ssid: '' },
        },
      ],
    }

    await render(staleWifiRoute)

    const node = wrapper!.findAll('.path-node')[1]
    expect(node.text()).toContain('Ethernet')
    expect(node.text()).toContain('Normal')
    expect(node.text()).not.toContain('WLAN')
    expect(wrapper!.get('.path-diagnosis').text()).not.toContain('default egress interface')
  })

  it('shows Wi-Fi details when the wireless adapter owns the default route', async () => {
    vi.setSystemTime(new Date('2026-07-13T01:00:30Z'))
    const wirelessDefault: AgentInterfaces = {
      ...connected,
      default_route: { gateway: '192.168.1.1', interface: 'en0' },
      interfaces: [{
        ...connected.interfaces[0],
        gateway: '192.168.1.1',
        wifi: { ...connected.interfaces[0].wifi!, ssid: 'Office Wi-Fi' },
      }],
    }

    await render(wirelessDefault)

    const node = wrapper!.findAll('.path-node')[1]
    expect(node.text()).toContain('Wi-Fi')
    expect(node.text()).toContain('Normal')
    expect(node.text()).toContain('en0 · Office Wi-Fi · -65 dBm')
  })

  it('renders one timeline with online events left and offline events right', async () => {
    const history: StatusEvent[] = Array.from({ length: 20 }, (_, index) => ({
      status: index % 2 ? 'online' : 'offline',
      changed_at: `2026-07-13T${String(index).padStart(2, '0')}:00:00Z`,
    }))
    await render(connected, baseAgent, [], history)

    const timeline = wrapper!.get('.timeline-track')
    const events = timeline.findAll('.timeline-event')
    expect(events).toHaveLength(20)
    expect(events[0].classes()).toContain('is-offline')
    expect(events[1].classes()).toContain('is-online')
    expect(events.slice(0, 3).map((event) => event.get('.row-number').text())).toEqual(['1', '2', '3'])
    expect(wrapper?.get('.activity-surface').text()).toContain('20 records')
  })
  it('applies the instance layout returned by the server on initial load', async () => {
    const serverLayout = {
      version: 2,
      cards: [
        { id: 'availability', type: 'availability', visible: true, size: 'medium' },
        { id: 'overall', type: 'overall', visible: true, size: 'wide' },
        { id: 'latency', type: 'latency', visible: false, size: 'compact' },
      ],
    }
    await render(connected, baseAgent, [], [], serverLayout)

    const availability = wrapper!.findAll('.insight-card').find((card) => card.text().includes('Current availability'))!
    expect(availability.attributes('style')).toContain('order: 0')
    expect(wrapper!.get('.agent-hero').attributes('style')).toContain('order: 1')
    expect(wrapper!.findAll('.insight-card').some((card) => card.text().includes('Current latency'))).toBe(false)
  })

  it('uses the simple preset for an instance without a saved layout', async () => {
    await render(connected, baseAgent, [], [], null)

    const expectedVisible = [
      'overall', 'path-status', 'active-alerts', 'monitor-health', 'network-quality', 'traffic-trend', 'lan-devices',
    ]
    for (const [index, id] of expectedVisible.entries()) {
      expect(wrapper!.get('[data-layout-card="' + id + '"]').attributes('style')).toContain('order: ' + index)
    }
    for (const id of ['availability', 'nat-summary', 'wifi-summary', 'lan-summary']) {
      expect(wrapper!.find('[data-layout-card="' + id + '"]').exists()).toBe(false)
    }
    expect(wrapper!.find('[data-layout-card="data-freshness"]').exists()).toBe(false)
    expect(wrapper!.find('[data-layout-card="interfaces"]').exists()).toBe(false)

    await wrapper!.get('.layout-add-button').trigger('click')
    expect(wrapper!.get('[data-layout-preset="simple"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper!.get('[data-layout-preset="professional"]').attributes('aria-pressed')).toBe('false')
    expect(wrapper!.get('.layout-mode-chip').text()).toBe('Simple view')
  })

  it('previews a professional preset, keeps customization, and saves only on request', async () => {
    await render(connected, baseAgent, [], [], null)
    await wrapper!.get('.layout-add-button').trigger('click')

    await wrapper!.get('[data-layout-preset="professional"]').trigger('click')
    expect(apiMock.updateDashboardLayout).not.toHaveBeenCalled()
    expect(wrapper!.get('[data-layout-preset="professional"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper!.find('[data-layout-card="interfaces"]').exists()).toBe(true)

    const latency = wrapper!.get('[data-layout-card="latency"]')
    await latency.findAll('.ratio-buttons button')[1].trigger('click')
    expect(wrapper!.get('.layout-mode-chip').text()).toBe('Custom')
    expect(wrapper!.get('[data-layout-preset="professional"]').attributes('aria-pressed')).toBe('false')

    await wrapper!.get('.direct-layout-actions .btn-primary').trigger('click')
    await flushPromises()

    expect(apiMock.updateDashboardLayout).toHaveBeenCalledOnce()
    const stored = apiMock.updateDashboardLayout.mock.calls[0][0]
    expect(stored.cards.every((card: { visible: boolean }) => card.visible)).toBe(true)
    expect(stored.cards.find((card: { id: string }) => card.id === 'latency').size).toBe('medium')
  })

  it('cancels a preset preview and restores the saved layout', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await render(connected)
    await wrapper!.get('.layout-add-button').trigger('click')

    await wrapper!.get('[data-layout-preset="simple"]').trigger('click')
    expect(wrapper!.get('[data-layout-preset="simple"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper!.find('[data-layout-card="interfaces"]').exists()).toBe(false)

    await wrapper!.get('.direct-layout-actions .btn:not(.btn-primary)').trigger('click')
    expect(confirm).toHaveBeenCalledOnce()
    expect(wrapper!.find('.layout-presets').exists()).toBe(false)
    expect(wrapper!.find('[data-layout-card="interfaces"]').exists()).toBe(true)

    await wrapper!.get('.layout-add-button').trigger('click')
    expect(wrapper!.get('[data-layout-preset="professional"]').attributes('aria-pressed')).toBe('true')
    confirm.mockRestore()
  })

  it('directly drags, resizes, removes, and re-adds widgets before saving', async () => {
    await render(connected)

    await wrapper!.get('.layout-add-button').trigger('click')
    expect(wrapper!.find('.layout-card-list').exists()).toBe(false)
    expect(wrapper!.find('.widget-catalog').exists()).toBe(true)
    await wrapper!.get('.dashboard-page').trigger('click')
    expect(wrapper!.find('.widget-catalog').exists()).toBe(true)

    const cards = wrapper!.findAll('.insight-card')
    const availability = cards.find((card) => card.text().includes('Current availability'))!
    const latency = cards.find((card) => card.text().includes('Current latency'))!
    const dataTransfer = { effectAllowed: '', setData: vi.fn() }
    await latency.trigger('dragstart', { dataTransfer })
    await availability.trigger('drop')
    await latency.findAll('.ratio-buttons button')[1].trigger('click')

    await wrapper!.get('.interface-surface .remove-card-button').trigger('click')
    expect(wrapper!.find('.interface-surface').exists()).toBe(false)
    expect(wrapper!.find('.widget-catalog').exists()).toBe(true)
    const adapterOption = wrapper!.findAll('.widget-option').find((option) => option.text().includes('Network adapters'))!
    await adapterOption.get('.btn-primary').trigger('click')
    expect(wrapper!.find('.interface-surface').exists()).toBe(true)
    expect(wrapper!.find('.widget-catalog').exists()).toBe(true)
    await wrapper!.get('.interface-surface .remove-card-button').trigger('click')

    await wrapper!.get('.direct-layout-actions .btn-primary').trigger('click')
    await flushPromises()
    expect(wrapper!.find('.widget-catalog').exists()).toBe(false)
    const stored = apiMock.updateDashboardLayout.mock.calls[0][0]
    expect(stored.cards.find((card: { id: string }) => card.id === 'interfaces').visible).toBe(false)
    expect(stored.cards.find((card: { id: string }) => card.id === 'latency').size).toBe('medium')
    expect(stored.cards.slice(0, 3).map((card: { id: string }) => card.id)).toEqual([
      'overall', 'path-status', 'latency',
    ])
  })

  it('keeps the layout draft open when the server save fails', async () => {
    await render(connected)

    apiMock.updateDashboardLayout.mockRejectedValueOnce(new Error('server unavailable'))
    await wrapper!.get('.layout-add-button').trigger('click')
    await wrapper!.get('.interface-surface .remove-card-button').trigger('click')
    await wrapper!.get('.direct-layout-actions .btn-primary').trigger('click')
    await flushPromises()

    expect(wrapper!.find('.widget-catalog').exists()).toBe(true)
    expect(wrapper!.get('.direct-layout-toolbar .err').text()).toContain('Could not save the layout')
    expect(apiMock.updateDashboardLayout).toHaveBeenCalledOnce()
  })

  it('keeps an add-widget recovery action when every widget is hidden', async () => {
    await render(connected)

    await wrapper!.get('.layout-add-button').trigger('click')
    while (wrapper!.find('.remove-card-button').exists()) {
      await wrapper!.get('.remove-card-button').trigger('click')
    }
    await wrapper!.get('.direct-layout-actions .btn-primary').trigger('click')

    const empty = wrapper!.get('.empty-layout-state')
    expect(empty.text()).toContain('All widgets are hidden')
    expect(empty.get('button').text()).toContain('Add widget')
  })

  it('renders the action, freshness, wireless, trend, and incident widgets', async () => {
    apiMock.faultSignals.mockResolvedValueOnce([{
      id: 'sig-1', title: 'ICMP probe unreachable', agent_id: 'agent-1', agent_name: 'host-1',
      target_id: 'icmp-1', target_name: 'Public anchor', target_addr: '1.1.1.1',
      detector_key: 'availability', probe_kind: 'icmp', layer: 'internet', severity: 'critical',
      state: 'firing', metric_kind: 'probe.icmp.loss_pct', comparator: 'gte', value: 100,
      threshold: 100, reason_code: 3, reason_detail: 'no route to host',
      observed_at: '2026-07-16T01:00:00Z', confirmed_at: '2026-07-16T01:00:30Z',
      resolved_at: null, incident_id: 'inc-1', currently_abnormal: true,
      fail_threshold: 3, recover_threshold: 2, group_name: '', site_id: 'site_default',
      desc_en: 'Packet loss is critical',
    }])
    apiMock.agentMonitorStatus.mockResolvedValueOnce([
      {
        agent_id: 'agent-1', monitor_id: 'icmp-1', kind: 'icmp', target: '1.1.1.1',
        status: 'active', missing_permissions: [], config_version: 1, updated_at: '2026-07-16T02:00:00Z',
      },
      {
        agent_id: 'agent-1', monitor_id: 'dns-1', kind: 'dns', target: 'example.com',
        status: 'permission_blocked', missing_permissions: ['network.dns'], config_version: 1,
        updated_at: '2026-07-16T02:00:00Z',
      },
    ])
    apiMock.incidents.mockResolvedValueOnce({
      items: [], total: 4, page: 1, page_size: 1,
      summary: { open: 2, opened_24h: 3, resolved_24h: 1, top_layer: 'dns' },
    })
    const history = (kind: string, value: number, unit: string): Sample[] => [{
      ts: '2026-07-16T01:55:00Z', kind, target: kind.startsWith('probe.') ? '1.1.1.1' : 'host',
      layer: kind.startsWith('probe.') ? 'internet' : 'host', value, unit, monitor_id: kind.startsWith('probe.') ? 'icmp-1' : undefined,
    }]
    apiMock.metrics
      .mockResolvedValueOnce(history('probe.icmp.rtt_ms', 42, 'ms'))
      .mockResolvedValueOnce(history('probe.icmp.loss_pct', 2, 'pct'))
      .mockResolvedValueOnce(history('probe.icmp.jitter_ms', 4, 'ms'))
      .mockResolvedValueOnce(history('host.net.rx_bps', 2048, 'bps'))
      .mockResolvedValueOnce(history('host.net.tx_bps', 1024, 'bps'))
    // The quality stat numbers (P95 / avg) come from the server-side worst-target
    // aggregate, not from the chart samples above.
    const summaryEntry = (p95: number, avg: number) => ({
      latest: { ts: '2026-07-16T01:55:00Z', value: p95 },
      latest_nonzero: { ts: '2026-07-16T01:55:00Z', value: p95 },
      p95, avg, count: 1,
    })
    apiMock.metricsSummary.mockResolvedValueOnce({
      window_seconds: 86400,
      kinds: {
        'probe.icmp.rtt_ms': summaryEntry(42, 42),
        'probe.icmp.jitter_ms': summaryEntry(4, 4),
        'probe.icmp.loss_pct': summaryEntry(2, 2),
      },
    })

    await render(connected, baseAgent, [
      ...history('probe.icmp.loss_pct', 100, 'pct'),
      ...history('host.net.rx_bps', 2048, 'bps'),
      ...history('host.net.tx_bps', 1024, 'bps'),
    ])

    expect(wrapper!.get('.alert-summary-card').text()).toContain('ICMP probe unreachable')
    expect(wrapper!.get('[data-layout-card="monitor-health"]').text()).toContain('Probe failed')
    expect(wrapper!.get('[data-layout-card="monitor-health"]').text()).toContain('Permission / target blocked')
    expect(wrapper!.get('[data-layout-card="network-quality"]').text()).toContain('42.0 ms')
    expect(wrapper!.get('[data-layout-card="data-freshness"]').text()).toContain('Data freshness')
    expect(wrapper!.get('[data-layout-card="wifi-summary"]').text()).toContain('Wi-Fi summary')
    expect(wrapper!.get('[data-layout-card="traffic-trend"]').text()).toContain('2.0 KB/s')
    expect(wrapper!.get('[data-layout-card="incident-summary"]').text()).toContain('DNS')
    expect(wrapper!.get('[data-layout-card="incident-summary"]').text()).toContain('3')
    expect(wrapper!.findAll('.metric-chart-stub')).toHaveLength(2)
  })

  it('adds and persists multiple cards for different targets of the same monitoring type', async () => {
    const monitor = (id: string, name: string): TargetStatusRow => ({
      target_id: id,
      group_id: 'group',
      name,
      kind: 'icmp',
      target: id === 'icmp-1' ? '1.1.1.1' : '8.8.8.8',
      enabled: true,
      display_state: 'healthy',
      applicable_agents: 1,
      affected_agents: 0,
      signal_ids: [],
      incident_ids: [],
      agents: [{
        agent_id: baseAgent.id,
        agent_name: baseAgent.display_name,
        agent_online: true,
        execution_state: 'collecting',
        probe_state: 'healthy',
        fault_state: 'normal',
        reason_code: 'ok',
        missing_permissions: [],
        matched_selector: '',
        block_reason: '',
        availability_24h: 1,
      }],
    })
    targetStatus.targets = [monitor('icmp-1', 'Cloudflare DNS'), monitor('icmp-2', 'Google DNS')]
    await render(connected, baseAgent, [
      { ts: '2026-07-13T01:00:00Z', kind: 'probe.icmp.rtt_ms', target: '1.1.1.1', layer: 'internet', value: 36, unit: 'ms', monitor_id: 'icmp-1' },
      { ts: '2026-07-13T01:00:00Z', kind: 'probe.icmp.rtt_ms', target: '8.8.8.8', layer: 'internet', value: 42, unit: 'ms', monitor_id: 'icmp-2' },
    ], [], null)

    expect(wrapper!.find('.target-card-add-button').exists()).toBe(false)
    await wrapper!.get('.layout-add-button').trigger('click')
    const monitorWidget = wrapper!.get('[data-widget-type="monitor-target"]')
    expect(monitorWidget.text()).toContain('Monitoring target')
    await wrapper!.get('.target-card-add-button').trigger('click')
    expect(wrapper!.findAll('.target-card-drawer select')[1].findAll('option')).toHaveLength(2)
    await wrapper!.get('.target-card-drawer footer .btn-primary').trigger('click')

    await wrapper!.get('.target-card-add-button').trigger('click')
    await wrapper!.findAll('.target-card-drawer select')[1].setValue('icmp-2')
    await wrapper!.get('.target-card-drawer footer .btn-primary').trigger('click')

    const cards = wrapper!.findAll('.monitor-target-card')
    expect(cards).toHaveLength(2)
    expect(cards[0].text()).toContain('Cloudflare DNS')
    expect(cards[1].text()).toContain('Google DNS')

    await wrapper!.get('.direct-layout-actions .btn-primary').trigger('click')
    await flushPromises()
    const stored = apiMock.updateDashboardLayout.mock.calls[0][0]
    expect(stored.version).toBe(2)
    expect(stored.cards.filter((card: { type: string }) => card.type === 'monitor-target').map((card: { target_id: string }) => card.target_id)).toEqual(['icmp-1', 'icmp-2'])
  })
})
