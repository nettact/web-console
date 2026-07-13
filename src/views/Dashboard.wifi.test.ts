import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import en from '../locales/en'
import Dashboard from './Dashboard.vue'
import type { Agent, AgentInterfaces, Sample, StatusEvent } from '../api'

const apiMock = vi.hoisted(() => ({
  agents: vi.fn(),
  quota: vi.fn(),
  metrics: vi.fn(),
  latest: vi.fn(),
  listDevices: vi.fn(),
  agentStatusHistory: vi.fn(),
  agentInterfaces: vi.fn(),
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
  capabilities: ['network.wifi.read'],
  last_seen_at: '2026-07-13T01:00:00Z',
  created_at: '2026-07-13T00:00:00Z',
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

async function render(
  ifaces: AgentInterfaces,
  agent: Agent = baseAgent,
  latest: Sample[] = [],
  history: StatusEvent[] = [],
) {
  apiMock.agents.mockResolvedValue([agent])
  apiMock.quota.mockResolvedValue({ used: 1, max: 10 })
  apiMock.metrics.mockResolvedValue([])
  apiMock.latest.mockResolvedValue(latest)
  apiMock.listDevices.mockResolvedValue([])
  apiMock.agentStatusHistory.mockResolvedValue(history)
  apiMock.agentInterfaces.mockResolvedValue(ifaces)

  wrapper = mount(Dashboard, {
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })],
      stubs: {
        MetricChart: { template: '<div class="metric-chart-stub" />' },
        RouterLink: { template: '<a><slot /></a>' },
      },
    },
  })
  await flushPromises()
  await flushPromises()
  return wrapper.get('.interface-surface')
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.useRealTimers()
})

describe('Dashboard network adapter list', () => {
  it('merges readable Wi-Fi values into the matching adapter row', async () => {
    const card = await render(connected)
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
    const card = await render(disconnected, baseAgent, oldLatest)
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
    const card = await render(unreadable)
    expect(card.text()).toContain('Unreadable')
    expect(card.text()).toContain('System permission required')
  })

  it('marks merged Wi-Fi details stale while the agent is offline', async () => {
    const card = await render(connected, { ...baseAgent, status: 'offline' })
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
    const card = await render(wired, { ...baseAgent, capabilities: [] })
    expect(card.text()).toContain('eth0')
    expect(card.text()).toContain('Network adapter')
    expect(card.text()).not.toContain('Wi-Fi status not supported')
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
})
