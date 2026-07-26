import { flushPromises, shallowMount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Agent } from '../api'
import en from '../locales/en'
import HostMetrics from './HostMetrics.vue'
import Processes from './Processes.vue'

const apiMock = vi.hoisted(() => ({
  agents: vi.fn(),
  agent: vi.fn(),
  listSeries: vi.fn(),
  requestSnapshot: vi.fn(),
}))

vi.mock('../api', () => ({ api: apiMock }))
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  RouterLink: { template: '<a><slot /></a>' },
}))

const renamedAgent = {
  id: 'agent-1',
  site_id: 'site-1',
  display_name: 'Taipei NAS',
  hostname: 'random-7f2a',
  platform: 'linux',
  agent_version: 'test',
  status: 'online',
  supported: [],
  granted: [],
  effective: [],
  policy_source: 'environment',
  policy_hash: 'test',
  last_seen_at: null,
  created_at: '2026-01-01T00:00:00Z',
  first_connected_at: null,
  last_disconnect_kind: '',
  connectivity_alerts_muted: false,
} satisfies Agent

function options() {
  return {
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })],
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  apiMock.agents.mockResolvedValue([renamedAgent])
  apiMock.agent.mockResolvedValue(renamedAgent)
  apiMock.listSeries.mockResolvedValue([])
  apiMock.requestSnapshot.mockResolvedValue({ request_id: null, scopes: [] })
})

describe('Agent selectors', () => {
  it('shows the operator alias on Host Metrics', async () => {
    const wrapper = shallowMount(HostMetrics, options())
    await flushPromises()

    expect(wrapper.get('select option').text()).toBe('Taipei NAS (linux)')
    expect(wrapper.get('select option').text()).not.toContain('random-7f2a')
    wrapper.unmount()
  })

  it('shows the operator alias on Processes', async () => {
    const wrapper = shallowMount(Processes, options())
    await flushPromises()

    expect(wrapper.get('select option').text()).toContain('Taipei NAS (linux)')
    expect(wrapper.get('select option').text()).not.toContain('random-7f2a')
    wrapper.unmount()
  })
})
