import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const apiMock = vi.hoisted(() => ({ metricsSummary: vi.fn() }))
vi.mock('../../api', () => ({ api: apiMock }))

import TargetStatusPerformance from './TargetStatusPerformance.vue'
import { i18n } from '../../i18n'

const kindSummary = (latest: number | null, p95: number | null, count: number) => ({
  latest: latest == null ? null : { ts: '2026-07-19T00:00:03Z', value: latest },
  p95,
  count,
})

const summaryOf = (kinds: Record<string, ReturnType<typeof kindSummary>>) => ({
  window_seconds: 7200,
  kinds,
})

beforeEach(() => {
  apiMock.metricsSummary.mockReset().mockResolvedValue(summaryOf({
    'probe.icmp.rtt_ms': kindSummary(35, 35, 3),
    'probe.icmp.loss_pct': kindSummary(2.5, 2.5, 1),
  }))
})

describe('target-status Agent performance facts', () => {
  it('shows latest latency, packet loss, and two-hour raw latency P95 for ICMP', async () => {
    const wrapper = mount(TargetStatusPerformance, {
      props: { targetId: 'target-1', targetKind: 'icmp', agentId: 'agent-1' },
      global: { plugins: [i18n] },
    })
    await flushPromises()

    expect(apiMock.metricsSummary).toHaveBeenCalledTimes(1)
    expect(apiMock.metricsSummary).toHaveBeenCalledWith(
      'agent-1',
      ['probe.icmp.rtt_ms', 'probe.icmp.loss_pct'],
      { monitor: 'target-1' },
    )
    expect(wrapper.get('[data-test="latency"] strong').text()).toBe('35 ms')
    expect(wrapper.get('[data-test="loss"] strong').text()).toBe('2.5%')
    expect(wrapper.get('[data-test="p95"] strong').text()).toBe('35 ms')
    expect(wrapper.get('[data-test="latency"]').classes()).not.toContain('tone-attention')
    expect(wrapper.get('[data-test="latency"]').classes()).not.toContain('tone-severe')
    expect(wrapper.get('[data-test="loss"]').classes()).toContain('tone-attention')
    expect(wrapper.get('[data-test="p95"]').classes()).not.toContain('tone-attention')
  })

  it('uses red only for severe latency and loss', async () => {
    apiMock.metricsSummary.mockResolvedValue(summaryOf({
      'probe.icmp.rtt_ms': kindSummary(250, 250, 1),
      'probe.icmp.loss_pct': kindSummary(5, 5, 1),
    }))
    const wrapper = mount(TargetStatusPerformance, {
      props: { targetId: 'target-1', targetKind: 'icmp', agentId: 'agent-1' },
      global: { plugins: [i18n] },
    })
    await flushPromises()

    expect(wrapper.get('[data-test="latency"]').classes()).toContain('tone-severe')
    expect(wrapper.get('[data-test="loss"]').classes()).toContain('tone-severe')
    expect(wrapper.get('[data-test="p95"]').classes()).toContain('tone-severe')
  })

  it('uses HTTP-specific latency thresholds', async () => {
    apiMock.metricsSummary.mockResolvedValue(summaryOf({
      'probe.http.latency_ms': kindSummary(700, 700, 1),
    }))
    const wrapper = mount(TargetStatusPerformance, {
      props: { targetId: 'target-1', targetKind: 'http', agentId: 'agent-1' },
      global: { plugins: [i18n] },
    })
    await flushPromises()

    expect(apiMock.metricsSummary).toHaveBeenCalledTimes(1)
    expect(apiMock.metricsSummary).toHaveBeenCalledWith(
      'agent-1',
      ['probe.http.latency_ms'],
      { monitor: 'target-1' },
    )
    expect(wrapper.get('[data-test="latency"]').classes()).toContain('tone-attention')
    expect(wrapper.get('[data-test="latency"]').classes()).not.toContain('tone-severe')
  })

  it('keeps NAT latency neutral and shows NAT type severity', async () => {
    apiMock.metricsSummary.mockResolvedValue(summaryOf({
      'probe.nat.rtt_ms': kindSummary(1500, 1500, 1),
      'probe.nat.type': kindSummary(5, 5, 1),
    }))
    const wrapper = mount(TargetStatusPerformance, {
      props: { targetId: 'target-1', targetKind: 'nat', agentId: 'agent-1' },
      global: { plugins: [i18n] },
    })
    await flushPromises()

    expect(apiMock.metricsSummary).toHaveBeenCalledTimes(1)
    expect(apiMock.metricsSummary).toHaveBeenCalledWith(
      'agent-1',
      ['probe.nat.rtt_ms', 'probe.nat.type'],
      { monitor: 'target-1' },
    )
    expect(wrapper.get('[data-test="latency"]').classes()).not.toContain('tone-attention')
    expect(wrapper.get('[data-test="latency"]').classes()).not.toContain('tone-severe')
    expect(wrapper.get('[data-test="p95"]').classes()).not.toContain('tone-attention')
    expect(wrapper.get('[data-test="nat-type"] strong').text()).toBe('Symmetric')
    expect(wrapper.get('[data-test="nat-type"]').classes()).toContain('tone-severe')
  })

  it('renders nothing when the window has no samples', async () => {
    apiMock.metricsSummary.mockResolvedValue(summaryOf({
      'probe.icmp.rtt_ms': kindSummary(null, null, 0),
      'probe.icmp.loss_pct': kindSummary(null, null, 0),
    }))
    const wrapper = mount(TargetStatusPerformance, {
      props: { targetId: 'target-1', targetKind: 'icmp', agentId: 'agent-1' },
      global: { plugins: [i18n] },
    })
    await flushPromises()

    expect(wrapper.find('.performance-facts').exists()).toBe(false)
  })

  it('does not reload when only the current status object causes a parent rerender', async () => {
    const wrapper = mount(TargetStatusPerformance, {
      props: { targetId: 'target-1', targetKind: 'icmp', agentId: 'agent-1' },
      global: { plugins: [i18n] },
    })
    await flushPromises()
    const card = wrapper.get('[data-test="latency"]').element

    await wrapper.setProps({ targetId: 'target-1', targetKind: 'icmp', agentId: 'agent-1' })
    await flushPromises()

    expect(apiMock.metricsSummary).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-test="latency"]').element).toBe(card)
  })
})
