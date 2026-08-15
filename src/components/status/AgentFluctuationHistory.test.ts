import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({ fluctuations: vi.fn() }))
vi.mock('../../api', () => ({ api: apiMock }))

import AgentFluctuationHistory from './AgentFluctuationHistory.vue'
import { i18n } from '../../i18n'

const fluctuation = (id: string, targetName: string) => ({
  id,
  site_id: 'site_default',
  agent_id: 'agent-a',
  agent_name: 'Taipei NUC',
  target_id: `target-${id}`,
  target_name: targetName,
  target_addr: `${targetName.toLowerCase()}.example.test`,
  probe_kind: 'icmp',
  layer: 'network',
  detector_key: 'availability',
  fail_rounds: 2,
  fail_threshold: 3,
  metric_kind: 'probe.round.ok',
  comparator: 'eq',
  value: 0,
  threshold: 1,
  reason_code: 1,
  reason_detail: 'timeout',
  rounds: [],
  started_at: '2026-08-13T17:55:00Z',
  ended_at: '2026-08-13T17:56:00Z',
  concurrent_targets: 0,
  concurrent_fluctuations: 0,
  concurrent_faults: 0,
  desc_zh: `${targetName} 探测超时`,
  desc_en: `${targetName} probe timed out`,
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-13T18:00:00Z'))
  apiMock.fluctuations.mockReset().mockResolvedValue({
    items: [fluctuation('one', 'Public DNS')],
    total: 32,
    page: 1,
    page_size: 15,
  })
})

afterEach(() => vi.useRealTimers())

function render(rangeSec = 3 * 3600) {
  return mount(AgentFluctuationHistory, {
    props: { agentId: 'agent-a', rangeSec },
    global: {
      plugins: [i18n],
      stubs: { RouterLink: true },
    },
  })
}

describe('Agent fluctuation history', () => {
  it('loads the selected Agent and time range and identifies each target', async () => {
    const wrapper = render()
    await flushPromises()

    expect(apiMock.fluctuations).toHaveBeenCalledWith({
      agent: 'agent-a',
      since: Math.floor(Date.now() / 1000) - 3 * 3600,
      page: 1,
      page_size: 15,
    })
    expect(wrapper.get('thead').text()).toContain(i18n.global.t('targetStatus.targetColumn'))
    expect(wrapper.get('tbody').text()).toContain('Public DNS')
    expect(wrapper.get('tbody').text()).toContain('public dns.example.test')
  })

  it('loads later pages from the server and resets to page one when scope changes', async () => {
    const wrapper = render()
    await flushPromises()

    await wrapper.findAll('.pager-btn')[1].trigger('click')
    await flushPromises()
    expect(apiMock.fluctuations).toHaveBeenNthCalledWith(2, {
      agent: 'agent-a',
      since: Math.floor(Date.now() / 1000) - 3 * 3600,
      page: 2,
      page_size: 15,
    })

    await wrapper.setProps({ agentId: 'agent-b', rangeSec: 90 * 86400 })
    await flushPromises()

    expect(apiMock.fluctuations).toHaveBeenNthCalledWith(3, {
      agent: 'agent-b',
      since: Math.floor(Date.now() / 1000) - 90 * 86400,
      page: 1,
      page_size: 15,
    })
  })

  it('changes page size on the server and returns to the first page', async () => {
    const wrapper = render()
    await flushPromises()

    await wrapper.get('.pager-size select').setValue('30')
    await flushPromises()

    expect(apiMock.fluctuations).toHaveBeenNthCalledWith(2, {
      agent: 'agent-a',
      since: Math.floor(Date.now() / 1000) - 3 * 3600,
      page: 1,
      page_size: 30,
    })
  })

  it('distinguishes a failed request from an empty history', async () => {
    apiMock.fluctuations.mockRejectedValueOnce(new Error('offline'))
    const wrapper = render()
    await flushPromises()

    expect(wrapper.text()).toContain(i18n.global.t('targetStatus.fluctuationsUnavailable'))
    expect(wrapper.text()).not.toContain(i18n.global.t('targetStatus.noFluctuations'))
  })
})
