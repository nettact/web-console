import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({ agentStatusHistory: vi.fn() }))
vi.mock('../../api', () => ({ api: apiMock }))

import AgentConnectivityHistory from './AgentConnectivityHistory.vue'
import { i18n } from '../../i18n'

type Event = { status: string; changed_at: string; reason?: string }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const event = (status: string, reason = ''): Event => ({
  status,
  reason,
  changed_at: status === 'online' ? '2026-08-13T17:00:00Z' : '2026-08-13T16:00:00Z',
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-13T18:00:00Z'))
  apiMock.agentStatusHistory.mockReset().mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
})

function render(rangeSec = 3 * 3600) {
  return mount(AgentConnectivityHistory, {
    props: { agentId: 'agent-a', active: true, rangeSec },
    global: { plugins: [i18n] },
  })
}

describe('Agent connectivity history requests', () => {
  it('uses the exact selected window for 3 hours and 90 days', async () => {
    const wrapper = render()
    await flushPromises()

    const nowSec = Math.floor(Date.now() / 1000)
    expect(apiMock.agentStatusHistory).toHaveBeenNthCalledWith(1, 'agent-a', nowSec - 3 * 3600)

    await wrapper.setProps({ rangeSec: 90 * 86400 })
    await flushPromises()
    expect(apiMock.agentStatusHistory).toHaveBeenNthCalledWith(2, 'agent-a', nowSec - 90 * 86400)
  })

  it('keeps the newer Agent result when the older request settles last', async () => {
    const older = deferred<Event[]>()
    const newer = deferred<Event[]>()
    apiMock.agentStatusHistory
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise)

    const wrapper = render()
    await flushPromises()
    await wrapper.setProps({ agentId: 'agent-b' })

    newer.resolve([event('offline', 'superseded')])
    await flushPromises()
    expect(wrapper.get('.connection-timeline').text()).toContain(i18n.global.t('agentStatus.disconnect.superseded'))

    older.resolve([event('online')])
    await flushPromises()
    expect(wrapper.get('.connection-timeline').text()).toContain(i18n.global.t('agentStatus.disconnect.superseded'))
    expect(wrapper.get('.connection-timeline').text()).not.toContain(i18n.global.t('agents.statusOnline'))
  })

  it('invalidates an in-flight request when the history view becomes inactive', async () => {
    const pending = deferred<Event[]>()
    apiMock.agentStatusHistory.mockReturnValueOnce(pending.promise)

    const wrapper = render()
    await flushPromises()
    expect(wrapper.find('[role="status"]').exists()).toBe(true)

    await wrapper.setProps({ active: false })
    await flushPromises()
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.find('.connection-timeline').exists()).toBe(false)

    pending.resolve([event('offline', 'error')])
    await flushPromises()
    expect(wrapper.find('.connection-timeline').exists()).toBe(false)
    expect(wrapper.text()).not.toContain(i18n.global.t('agentStatus.disconnect.error'))
  })
})
