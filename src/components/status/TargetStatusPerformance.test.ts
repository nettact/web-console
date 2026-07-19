import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const apiMock = vi.hoisted(() => ({ metrics: vi.fn() }))
vi.mock('../../api', () => ({ api: apiMock }))

import TargetStatusPerformance from './TargetStatusPerformance.vue'
import { i18n } from '../../i18n'

const sample = (kind: string, value: number, second: number) => ({
  ts: `2026-07-19T00:00:${String(second).padStart(2, '0')}Z`,
  kind,
  target: '1.1.1.1',
  layer: 'network',
  value,
  unit: kind.endsWith('loss_pct') ? '%' : 'ms',
  monitor_id: 'target-1',
})

beforeEach(() => {
  apiMock.metrics.mockReset().mockImplementation((_agentID: string, kind: string) => {
    if (kind === 'probe.icmp.rtt_ms') return Promise.resolve([
      sample(kind, 10, 1), sample(kind, 20, 2), sample(kind, 35, 3),
    ])
    if (kind === 'probe.icmp.loss_pct') return Promise.resolve([sample(kind, 2.5, 4)])
    return Promise.resolve([])
  })
})

describe('target-status Agent performance facts', () => {
  it('shows latest latency, packet loss, and two-hour raw latency P95 for ICMP', async () => {
    const wrapper = mount(TargetStatusPerformance, {
      props: { targetId: 'target-1', targetKind: 'icmp', agentId: 'agent-1' },
      global: { plugins: [i18n] },
    })
    await flushPromises()

    expect(apiMock.metrics).toHaveBeenCalledTimes(2)
    expect(apiMock.metrics).toHaveBeenCalledWith('agent-1', 'probe.icmp.rtt_ms', {
      monitor: 'target-1', limit: 2000, sinceSeconds: 7200,
    })
    expect(apiMock.metrics).toHaveBeenCalledWith('agent-1', 'probe.icmp.loss_pct', {
      monitor: 'target-1', limit: 2000, sinceSeconds: 7200,
    })
    expect(wrapper.get('[data-test="latency"] strong').text()).toBe('35 ms')
    expect(wrapper.get('[data-test="loss"] strong').text()).toBe('2.5%')
    expect(wrapper.get('[data-test="p95"] strong').text()).toBe('35 ms')
    expect(wrapper.get('[data-test="latency"]').classes()).not.toContain('tone-attention')
    expect(wrapper.get('[data-test="latency"]').classes()).not.toContain('tone-severe')
    expect(wrapper.get('[data-test="loss"]').classes()).toContain('tone-attention')
    expect(wrapper.get('[data-test="p95"]').classes()).not.toContain('tone-attention')
  })

  it('uses red only for severe latency and loss', async () => {
    apiMock.metrics.mockImplementation((_agentID: string, kind: string) => {
      if (kind === 'probe.icmp.rtt_ms') return Promise.resolve([sample(kind, 250, 1)])
      if (kind === 'probe.icmp.loss_pct') return Promise.resolve([sample(kind, 5, 2)])
      return Promise.resolve([])
    })
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
    apiMock.metrics.mockImplementation((_agentID: string, kind: string) =>
      Promise.resolve(kind === 'probe.http.latency_ms' ? [sample(kind, 700, 1)] : []),
    )
    const wrapper = mount(TargetStatusPerformance, {
      props: { targetId: 'target-1', targetKind: 'http', agentId: 'agent-1' },
      global: { plugins: [i18n] },
    })
    await flushPromises()

    expect(apiMock.metrics).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-test="latency"]').classes()).toContain('tone-attention')
    expect(wrapper.get('[data-test="latency"]').classes()).not.toContain('tone-severe')
  })

  it('keeps NAT latency neutral and shows NAT type severity', async () => {
    apiMock.metrics.mockImplementation((_agentID: string, kind: string) => {
      if (kind === 'probe.nat.rtt_ms') return Promise.resolve([sample(kind, 1500, 1)])
      if (kind === 'probe.nat.type') return Promise.resolve([sample(kind, 5, 2)])
      return Promise.resolve([])
    })
    const wrapper = mount(TargetStatusPerformance, {
      props: { targetId: 'target-1', targetKind: 'nat', agentId: 'agent-1' },
      global: { plugins: [i18n] },
    })
    await flushPromises()

    expect(apiMock.metrics).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[data-test="latency"]').classes()).not.toContain('tone-attention')
    expect(wrapper.get('[data-test="latency"]').classes()).not.toContain('tone-severe')
    expect(wrapper.get('[data-test="p95"]').classes()).not.toContain('tone-attention')
    expect(wrapper.get('[data-test="nat-type"] strong').text()).toBe('Symmetric')
    expect(wrapper.get('[data-test="nat-type"]').classes()).toContain('tone-severe')
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

    expect(apiMock.metrics).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[data-test="latency"]').element).toBe(card)
  })
})
