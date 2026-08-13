import { computed, defineComponent } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const apiMock = vi.hoisted(() => ({
  metrics: vi.fn(),
  metricsSummary: vi.fn(),
  faultSignals: vi.fn(),
  fluctuations: vi.fn(),
}))
vi.mock('../../api', () => ({ api: apiMock }))

import TargetAcrossAgents from './TargetAcrossAgents.vue'
import { i18n } from '../../i18n'
import { targetStatus } from '../../targetStatus'

const MetricChartStub = defineComponent({
  props: {
    metrics: { type: Array, default: () => [] },
    timeWindow: { type: Object, default: undefined },
  },
  setup(props) {
    const values = computed(() => {
      const first = props.metrics[0] as { samples?: { value: number }[] } | undefined
      return first?.samples?.map((sample) => sample.value).join(',') ?? ''
    })
    const bounds = computed(() => {
      const value = props.timeWindow as { startMs?: number; endMs?: number } | undefined
      return value ? `${value.startMs}:${value.endMs}` : ''
    })
    return { values, bounds }
  },
  template: '<div class="metric-chart-stub" :data-window="bounds">{{ values }}</div>',
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

const prober = (series: Array<{ kind: string; target: string; layer: string; unit: string; monitor_id?: string }>) => ({
  agent,
  series,
})

const global = {
  plugins: [i18n],
  stubs: {
    MetricChart: MetricChartStub,
    MetricStatCards: true,
    FaultSignalsTable: true,
    FluctuationsTable: true,
    MonitorStateBadge: true,
  },
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-13T18:00:00Z'))
  targetStatus.targets = []
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
})

afterEach(() => {
  vi.useRealTimers()
  targetStatus.targets = []
})

describe('target history availability evidence', () => {
  it('keeps HTTP latency as the headline and opens only the broad timing charts', async () => {
    const targetName = 'https://example.com'
    const wrapper = mount(TargetAcrossAgents, {
      props: {
        family: 'probe.http',
        familyLabel: 'HTTP',
        target: targetName,
        monitorId: 'target-1',
        probers: [prober([
          { kind: 'probe.http.connect_ms', target: targetName, layer: 'service', unit: 'ms', monitor_id: 'target-1' },
          { kind: 'probe.http.connection_reused', target: targetName, layer: 'service', unit: 'bool', monitor_id: 'target-1' },
          { kind: 'probe.http.dns_ms', target: targetName, layer: 'service', unit: 'ms', monitor_id: 'target-1' },
          { kind: 'probe.http.latency_ms', target: targetName, layer: 'service', unit: 'ms', monitor_id: 'target-1' },
          { kind: 'probe.http.ok', target: targetName, layer: 'service', unit: 'bool', monitor_id: 'target-1' },
          { kind: 'probe.http.status', target: targetName, layer: 'service', unit: 'code', monitor_id: 'target-1' },
          { kind: 'probe.http.tls_ms', target: targetName, layer: 'service', unit: 'ms', monitor_id: 'target-1' },
          { kind: 'probe.http.total_ms', target: targetName, layer: 'service', unit: 'ms', monitor_id: 'target-1' },
          { kind: 'probe.http.ttfb_ms', target: targetName, layer: 'service', unit: 'ms', monitor_id: 'target-1' },
        ])],
        rangeSec: 3 * 3600,
        restrictToProbers: true,
      },
      global,
    })
    await flushPromises()

    const selectedChips = wrapper.findAll('.metric-picker .chip.active')
    expect(selectedChips.map((chip) => chip.text())).toEqual([
      'Latency',
      'Total time',
      'Time to first byte',
    ])
    expect(selectedChips.every((chip) => chip.attributes('aria-pressed') === 'true')).toBe(true)
    const connectChip = wrapper.findAll('.metric-picker .chip').find((chip) => chip.text() === 'Connect time')
    expect(connectChip?.attributes('type')).toBe('button')
    expect(connectChip?.attributes('aria-pressed')).toBe('false')
    await connectChip!.trigger('click')
    expect(connectChip?.attributes('aria-pressed')).toBe('true')
    await connectChip!.trigger('click')
    expect(connectChip?.attributes('aria-pressed')).toBe('false')
    expect(wrapper.findAll('.chart-card:not(.status-chart-card)')).toHaveLength(3)
    expect(wrapper.findAll('.status-chart-card')).toHaveLength(1)
    expect(wrapper.findAll('.nat-block h4').map((heading) => heading.text())).toEqual([
      'Status',
      'Connection reused',
    ])
    expect(wrapper.get('.latest-cell').text()).toContain('550 ms')
    expect(apiMock.metricsSummary).toHaveBeenCalledWith(
      'agent-1',
      ['probe.http.status', 'probe.http.connection_reused'],
      { monitor: 'target-1', target: undefined, sinceSeconds: 10_800 },
    )
    const fetchedKinds = apiMock.metrics.mock.calls.map(([, kind]) => kind)
    expect(fetchedKinds).not.toContain('probe.http.status')
    expect(fetchedKinds).not.toContain('probe.http.connection_reused')
  })

  it('uses the authoritative verdict-round ratio and shares the selected chart window', async () => {
    targetStatus.targets = [{
      target_id: 'target-1',
      group_id: 'group-1',
      name: 'Example',
      kind: 'http',
      target: 'https://example.com',
      enabled: true,
      display_state: 'healthy',
      applicable_agents: 1,
      affected_agents: 0,
      availability: 0.75,
      availability_rounds: 4,
      availability_ok_rounds: 3,
      signal_ids: [],
      incident_ids: [],
      agents: [{
        agent_id: 'agent-1',
        agent_name: 'imini',
        agent_online: true,
        execution_state: 'collecting',
        probe_state: 'healthy',
        fault_state: 'normal',
        reason_code: 'ok',
        missing_permissions: [],
        matched_selector: '',
        block_reason: '',
        availability: 0.75,
        availability_rounds: 4,
        availability_ok_rounds: 3,
      }],
    }]
    const wrapper = mount(TargetAcrossAgents, {
      props: {
        family: 'probe.http',
        familyLabel: 'HTTP',
        target: 'https://example.com',
        monitorId: 'target-1',
        probers: [prober([
            { kind: 'probe.http.ok', target: 'https://example.com', layer: 'service', unit: 'bool', monitor_id: 'target-1' },
            { kind: 'probe.http.latency_ms', target: 'https://example.com', layer: 'service', unit: 'ms', monitor_id: 'target-1' },
        ])],
        rangeSec: 7 * 86400,
        restrictToProbers: true,
      },
      global,
    })
    await flushPromises()

    expect(apiMock.metrics).toHaveBeenCalledWith(
      'agent-1',
      'probe.round.ok',
      { monitor: 'target-1', target: undefined, limit: 5000, sinceSeconds: 604_800 },
    )
    expect(wrapper.get('.summary-shell tbody').text()).toContain('75%')
    expect(wrapper.get('.summary-shell tbody').text()).toContain('3 / 4')
    expect(wrapper.get('.summary-shell tbody').text()).not.toContain('83.3%')
    expect(wrapper.get('.status-chart-card .metric-chart-stub').text()).toBe('1,0.5,1')
    expect(wrapper.get('.status-chart-card .metric-chart-stub').attributes('data-window')).toBe(
      `${Date.now() - 604_800_000}:${Date.now()}`,
    )
    expect(wrapper.get('.chart-card:not(.status-chart-card) .metric-chart-stub').attributes('data-window')).toBe(
      `${Date.now() - 604_800_000}:${Date.now()}`,
    )
    expect(wrapper.get('.coverage-cell').text()).toContain('2 min')
    expect(apiMock.faultSignals).toHaveBeenCalledWith(expect.objectContaining({
      target: 'target-1',
      agent: 'agent-1',
      since: expect.any(Number),
    }))
  })

  it('keeps availability aligned with loaded evidence until the next evidence refresh', async () => {
    targetStatus.targets = [{
      target_id: 'target-1',
      group_id: 'group-1',
      name: 'Example',
      kind: 'http',
      target: 'https://example.com',
      enabled: true,
      display_state: 'healthy',
      applicable_agents: 1,
      affected_agents: 0,
      availability: 0.75,
      availability_rounds: 4,
      availability_ok_rounds: 3,
      signal_ids: [],
      incident_ids: [],
      agents: [{
        agent_id: 'agent-1',
        agent_name: 'imini',
        agent_online: true,
        execution_state: 'collecting',
        probe_state: 'healthy',
        fault_state: 'normal',
        reason_code: 'ok',
        missing_permissions: [],
        matched_selector: '',
        block_reason: '',
        availability: 0.75,
        availability_rounds: 4,
        availability_ok_rounds: 3,
      }],
    }]
    const wrapper = mount(TargetAcrossAgents, {
      props: {
        family: 'probe.http',
        familyLabel: 'HTTP',
        target: 'https://example.com',
        monitorId: 'target-1',
        probers: [prober([
          { kind: 'probe.http.ok', target: 'https://example.com', layer: 'service', unit: 'bool', monitor_id: 'target-1' },
        ])],
        rangeSec: 3 * 3600,
        restrictToProbers: true,
      },
      global,
    })
    await flushPromises()

    expect(wrapper.get('.availability-value').text()).toContain('75%')
    expect(wrapper.get('.availability-value').text()).toContain('3 / 4')

    // An SSE-driven target-status refresh is live state. It must not relabel the
    // already loaded samples with a denominator from a newer server snapshot.
    targetStatus.targets = [{
      ...targetStatus.targets[0],
      availability: 0.5,
      availability_rounds: 2,
      availability_ok_rounds: 1,
      agents: [{
        ...targetStatus.targets[0].agents[0],
        availability: 0.5,
        availability_rounds: 2,
        availability_ok_rounds: 1,
      }],
    }]
    await flushPromises()

    expect(wrapper.get('.availability-value').text()).toContain('75%')
    expect(wrapper.get('.availability-value').text()).toContain('3 / 4')
    expect(wrapper.get('.availability-value').text()).not.toContain('50%')

    await wrapper.setProps({ rangeSec: 6 * 3600 })
    await flushPromises()

    expect(wrapper.get('.availability-value').text()).toContain('50%')
    expect(wrapper.get('.availability-value').text()).toContain('1 / 2')
  })

  it('keeps a real monitor unknown without an authoritative verdict even when every sample succeeded', async () => {
    apiMock.metrics.mockResolvedValue([
      {
        ts: new Date(Date.now() - 60_000).toISOString(),
        kind: 'probe.round.ok',
        target: 'https://example.com',
        layer: 'service',
        value: 1,
        unit: 'bool',
        monitor_id: 'target-1',
      },
    ])
    const wrapper = mount(TargetAcrossAgents, {
      props: {
        family: 'probe.http',
        familyLabel: 'HTTP',
        target: 'https://example.com',
        monitorId: 'target-1',
        probers: [prober([
          { kind: 'probe.http.ok', target: 'https://example.com', layer: 'service', unit: 'bool', monitor_id: 'target-1' },
        ])],
        rangeSec: 3 * 3600,
        restrictToProbers: true,
      },
      global,
    })
    await flushPromises()

    const row = wrapper.get('.summary-shell tbody tr')
    expect(row.get('.availability-value strong').text()).toBe('—')
    expect(row.get('.availability-value').text()).toContain(i18n.global.t('targetStatus.noVerdictRounds'))
    expect(row.get('.availability-value').text()).not.toContain('100%')
  })

  it('allows a monitor-less system status series to derive availability from samples', async () => {
    const wrapper = mount(TargetAcrossAgents, {
      props: {
        family: 'wifi',
        familyLabel: 'Wi-Fi',
        target: 'wlan0',
        probers: [prober([
          { kind: 'wifi.up', target: 'wlan0', layer: 'host', unit: 'bool' },
        ])],
        rangeSec: 3 * 3600,
      },
      global,
    })
    await flushPromises()

    expect(wrapper.get('.summary-shell tbody .availability-value strong').text()).toBe('100%')
  })
})
