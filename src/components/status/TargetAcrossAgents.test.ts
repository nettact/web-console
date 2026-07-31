import { computed, defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const apiMock = vi.hoisted(() => ({
  metrics: vi.fn(),
  metricsSummary: vi.fn(),
  faultSignals: vi.fn(),
  fluctuations: vi.fn(),
  targetAvailability: vi.fn(),
}))
vi.mock('../../api', () => ({ api: apiMock }))

import TargetAcrossAgents from './TargetAcrossAgents.vue'
import { i18n } from '../../i18n'

const MetricChartStub = defineComponent({
  props: { metrics: { type: Array, default: () => [] } },
  setup(props) {
    const values = computed(() => {
      const first = props.metrics[0] as { samples?: { value: number }[] } | undefined
      return first?.samples?.map((sample) => sample.value).join(',') ?? ''
    })
    return { values }
  },
  template: '<div class="metric-chart-stub">{{ values }}</div>',
})

const agent = {
  id: 'agent-1',
  site_id: 'site_default',
  display_name: 'imini',
  hostname: 'imini',
  platform: 'windows',
  agent_version: '1.0.0',
  status: 'online',
  supported: [],
  granted: [],
  effective: [],
  policy_source: 'default',
  policy_hash: '',
  last_seen_at: '2026-07-31T00:00:00Z',
  created_at: '2026-07-31T00:00:00Z',
  first_connected_at: '2026-07-31T00:00:00Z',
  last_disconnect_kind: '',
  connectivity_alerts_muted: false,
}

beforeEach(() => {
  const now = Date.now()
  const samples = (values: number[]) => values.map((value, index) => ({
    ts: new Date(now - (values.length - index) * 60_000).toISOString(),
    kind: 'probe.round.ok',
    target: 'https://example.com',
    layer: 'service',
    value,
    unit: 'bool',
    monitor_id: 'target-1',
  }))
  apiMock.metrics.mockReset().mockImplementation((_agentId: string, kind: string) => {
    if (kind === 'probe.round.ok') return Promise.resolve(samples([1, 0.5, 1]))
    if (kind === 'probe.http.latency_ms') return Promise.resolve(samples([500, 600, 550]))
    return Promise.resolve(samples([1, 1, 1]))
  })
  apiMock.metricsSummary.mockReset().mockResolvedValue({ window_seconds: 21_600, kinds: {} })
  apiMock.faultSignals.mockReset().mockResolvedValue([])
  apiMock.fluctuations.mockReset().mockResolvedValue({ items: [], total: 0 })
  apiMock.targetAvailability.mockReset().mockResolvedValue({ target_id: 'target-1', windows: [] })
})

describe('target history availability across storage tiers', () => {
  it('uses per-round rollup ratios without hiding a short failure', async () => {
    const wrapper = mount(TargetAcrossAgents, {
      props: {
        family: 'probe.http',
        familyLabel: 'HTTP',
        target: 'https://example.com',
        monitorId: 'target-1',
        probers: [{
          agent,
          series: [
            { kind: 'probe.http.ok', target: 'https://example.com', layer: 'service', unit: 'bool', monitor_id: 'target-1' },
            { kind: 'probe.http.latency_ms', target: 'https://example.com', layer: 'service', unit: 'ms', monitor_id: 'target-1' },
          ],
        }],
        rangeSec: 6 * 3600,
        restrictToProbers: true,
      },
      global: {
        plugins: [i18n],
        stubs: {
          MetricChart: MetricChartStub,
          MetricStatCards: true,
          FaultSignalsTable: true,
          FluctuationsTable: true,
          MonitorStateBadge: true,
        },
      },
    })
    await flushPromises()

    expect(apiMock.metrics).toHaveBeenCalledWith(
      'agent-1',
      'probe.round.ok',
      { monitor: 'target-1', target: undefined, limit: 5000, sinceSeconds: 21_600 },
    )
    expect(wrapper.get('.summary tbody').text()).toContain('83.3%')
    expect(wrapper.get('.summary tbody').text()).toContain('1')
    expect(wrapper.get('.status-chart-card .metric-chart-stub').text()).toBe('1,0.5,1')
  })
})
