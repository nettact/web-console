import { computed, defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({
  listSeries: vi.fn(),
  metrics: vi.fn(),
}))
vi.mock('../api', () => ({ api: apiMock }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }))

import HostMetrics from './HostMetrics.vue'
import { i18n } from '../i18n'

const MetricChartStub = defineComponent({
  props: {
    title: { type: String, default: '' },
    timeWindow: { type: Object, default: undefined },
  },
  setup(props) {
    const bounds = computed(() => {
      const value = props.timeWindow as { startMs?: number; endMs?: number } | undefined
      return value ? `${value.startMs}:${value.endMs}` : ''
    })
    return { bounds }
  },
  template: '<div class="metric-chart-stub" :data-title="title" :data-window="bounds" />',
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-13T18:00:00Z'))
  apiMock.listSeries.mockReset().mockResolvedValue([
    { kind: 'iface.up', target: 'Tailscale', layer: 'host', unit: 'bool' },
  ])
  apiMock.metrics.mockReset().mockResolvedValue([{
    ts: '2026-08-13T17:59:00Z',
    kind: 'iface.up',
    target: 'Tailscale',
    layer: 'host',
    value: 1,
    unit: 'bool',
  }])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('HostMetrics shared chart window', () => {
  it('pins sparse interface history to the full selected range', async () => {
    const rangeSec = 30 * 86400
    const wrapper = mount(HostMetrics, {
      props: { embedded: true, fixedAgentId: 'agent-1', fixedRangeSec: rangeSec },
      global: {
        plugins: [i18n],
        stubs: { MetricChart: MetricChartStub, MetricStatCards: true },
      },
    })
    await flushPromises()

    expect(apiMock.metrics).toHaveBeenCalledWith(
      'agent-1',
      'iface.up',
      { target: 'Tailscale', limit: 5000, sinceSeconds: rangeSec },
    )
    expect(wrapper.get('.metric-chart-stub').attributes('data-window')).toBe(
      `${Date.now() - rangeSec * 1000}:${Date.now()}`,
    )
  })
})
