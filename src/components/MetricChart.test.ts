import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { setOption, gradients } = vi.hoisted(() => ({
  setOption: vi.fn(),
  gradients: [] as unknown[][],
}))

vi.mock('echarts', () => ({
  init: () => ({
    setOption,
    resize: vi.fn(),
    dispose: vi.fn(),
    getWidth: () => 800,
    convertFromPixel: () => 0,
    convertToPixel: () => 0,
  }),
  color: {
    modifyAlpha: (color: string) => color,
    modifyHSL: (color: string, _h?: number, _s?: number, lightness?: number) => `${color}:${lightness}`,
  },
  graphic: {
    LinearGradient: class LinearGradient {
      constructor(...args: unknown[]) {
        gradients.push(args)
      }
    },
  },
}))

vi.mock('../lib/chartColor', () => ({
  chartColor: (_token: string, fallback: string) => fallback,
  oklchToRgb: (color: string) => color,
}))

import MetricChart from './MetricChart.vue'
import { i18n } from '../i18n'
import { theme } from '../theme'

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

const metric = (unit: string, kind: string) => ({
  key: 'agent-1',
  label: 'imini',
  kind,
  unit,
  color: '#0080ff',
  samples: [{
    ts: new Date(800).toISOString(),
    kind,
    target: 'https://example.com',
    layer: 'service',
    value: 1,
    unit,
  }],
})

const metricAt = (times: number[], unit = 'ms', kind = 'probe.http.latency_ms') => ({
  ...metric(unit, kind),
  samples: times.map((time, index) => ({
    ts: new Date(time).toISOString(),
    kind,
    target: 'https://example.com',
    layer: 'service',
    value: index + 1,
    unit,
  })),
})

beforeEach(() => {
  theme.value = 'dark'
  setOption.mockReset()
  gradients.length = 0
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(() => {
  theme.value = 'dark'
})

describe('MetricChart shared time window', () => {
  it('pins a sparse numeric chart to the selected range and keeps its one point visible', () => {
    mount(MetricChart, {
      props: {
        title: 'Latency',
        metrics: [metric('ms', 'probe.http.latency_ms')],
        timeWindow: { startMs: 0, endMs: 1_000 },
      },
      global: { plugins: [i18n] },
    })

    const option = setOption.mock.calls[0][0]
    expect(option.xAxis).toMatchObject({ min: 0, max: 1_000 })
    expect(option.series[0]).toMatchObject({ showSymbol: true, symbolSize: 8 })
    expect(option.aria).toMatchObject({ enabled: true, decal: { show: false } })
    expect(gradients[0]?.[4]).toEqual([
      { offset: 0, color: '#0080ff' },
      { offset: 0.34, color: '#0080ff' },
      { offset: 0.7, color: '#0080ff' },
      { offset: 1, color: '#0080ff' },
    ])
  })

  it('uses the same selected bounds for a boolean status timeline', () => {
    mount(MetricChart, {
      props: {
        title: 'Request status',
        metrics: [metric('bool', 'probe.http.ok')],
        timeWindow: { startMs: 0, endMs: 1_000 },
      },
      global: { plugins: [i18n] },
    })

    const option = setOption.mock.calls[0][0]
    expect(option.xAxis).toMatchObject({ min: 0, max: 1_000 })
    expect(option.aria).toMatchObject({ enabled: true, decal: { show: false } })
    expect(option.grid.left).toBeGreaterThanOrEqual(option.yAxis.axisLabel.width + 12)

    const renderItem = option.series[0].renderItem
    const cell = (ok: number) => renderItem({}, {
      value: (index: number) => [200, 700, ok, 0, 200, 700][index],
      coord: ([x, y]: [number, number]) => [x, y],
      size: () => [0, 20],
    })
    expect(cell(0).style).toMatchObject({
      fill: '#f87171',
      stroke: '#fecaca',
      lineWidth: 1,
      lineDash: [3, 2],
    })
    expect(cell(1).style).toEqual({ fill: '#34d399' })
  })

  it('reserves the right axis margin for compact dual-axis charts', () => {
    mount(MetricChart, {
      props: {
        title: 'Latency and loss',
        metrics: [
          metric('ms', 'probe.icmp.rtt_ms'),
          metric('pct', 'probe.icmp.loss_pct'),
        ],
        timeWindow: { startMs: 0, endMs: 1_000 },
      },
      global: { plugins: [i18n] },
    })

    const option = setOption.mock.calls[0][0]
    expect(option.yAxis).toHaveLength(2)
    expect(option.grid).toMatchObject({ left: 44, right: 72 })
  })

  it('shows the empty state when every valid sample is outside the selected window', () => {
    const wrapper = mount(MetricChart, {
      props: {
        title: 'Latency',
        metrics: [metricAt([-100, 1_100])],
        timeWindow: { startMs: 0, endMs: 1_000 },
      },
      global: { plugins: [i18n] },
    })

    expect(wrapper.find('.empty-state').exists()).toBe(true)
    expect(setOption.mock.calls[0][0].series[0]).toMatchObject({ showSymbol: false, symbolSize: 5 })
  })

  it('shows a single-point symbol based only on samples inside the selected window', () => {
    const wrapper = mount(MetricChart, {
      props: {
        title: 'Latency',
        metrics: [metricAt([-100, 800, 1_100])],
        timeWindow: { startMs: 0, endMs: 1_000 },
      },
      global: { plugins: [i18n] },
    })

    expect(wrapper.find('.empty-state').exists()).toBe(false)
    expect(setOption.mock.calls[0][0].series[0]).toMatchObject({ showSymbol: true, symbolSize: 8 })
  })

  it('formats a gap tooltip without treating its inserted null as a number', () => {
    mount(MetricChart, {
      props: {
        title: 'Traffic',
        metrics: [metricAt([0, 10_000, 200_000], 'bytes', 'host.net.rx_bytes')],
        timeWindow: { startMs: 0, endMs: 300_000 },
      },
      global: { plugins: [i18n] },
    })

    const option = setOption.mock.calls[0][0]
    const gap = option.series[0].data.find((point: [number, number | null]) => point[1] === null)
    expect(gap).toBeTruthy()

    const formatter = option.tooltip.formatter as (params: unknown[]) => string
    expect(() => formatter([{
      axisValue: gap[0],
      seriesName: 'imini',
      marker: '<i></i>',
      value: gap,
    }])).not.toThrow()
    expect(formatter([{
      axisValue: gap[0],
      seriesName: 'imini',
      marker: '<i></i>',
      value: gap,
    }])).toContain(i18n.global.t('chart.noData'))
  })

  it('darkens the existing series hue on a light canvas', () => {
    theme.value = 'light'
    mount(MetricChart, {
      props: {
        title: 'Latency',
        metrics: [metric('ms', 'probe.http.latency_ms')],
        timeWindow: { startMs: 0, endMs: 1_000 },
      },
      global: { plugins: [i18n] },
    })

    const option = setOption.mock.calls[0][0]
    expect(option.series[0].lineStyle.color).toBe('#0080ff:0.32')
    expect(option.series[0].itemStyle.color).toBe('#0080ff:0.32')
  })

  it('uses a paged legend for many series instead of overflowing the plot', () => {
    mount(MetricChart, {
      props: {
        title: 'CPU cores',
        metrics: Array.from({ length: 12 }, (_, index) => ({
          ...metric('pct', 'host.cpu.core.pct'),
          key: `core-${index}`,
          label: `Core ${index}`,
        })),
        timeWindow: { startMs: 0, endMs: 1_000 },
      },
      global: { plugins: [i18n] },
    })

    const option = setOption.mock.calls[0][0]
    expect(option.legend).toMatchObject({ type: 'scroll', left: 8, right: 8 })
  })
})
