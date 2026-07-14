import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import en from '../locales/en'
import Monitoring from './Monitoring.vue'

const apiMock = vi.hoisted(() => ({
  listTargets: vi.fn(), agentGroups: vi.fn(), setTargets: vi.fn(),
  purgeMonitor: vi.fn(), purgeTarget: vi.fn(),
  agents: vi.fn(), latest: vi.fn(), targetAgentStatus: vi.fn(),
}))

vi.mock('../api', () => ({ api: apiMock }))

beforeEach(() => {
  vi.clearAllMocks()
  apiMock.agentGroups.mockResolvedValue([])
  apiMock.agents.mockResolvedValue([])
  apiMock.latest.mockResolvedValue([])
  apiMock.targetAgentStatus.mockResolvedValue([])
})

it('renders host/* as Wi-Fi inside the existing host monitoring type', async () => {
  apiMock.listTargets.mockResolvedValue([{
    id: 'wifi-anchor', kind: 'host', name: 'Office Wi-Fi', target: '*', params: {},
    enabled: true, all_agents: true, group_ids: [],
  }])
  apiMock.agentGroups.mockResolvedValue([])
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
  const page = mount(Monitoring, {
    global: { plugins: [i18n], stubs: { RouterLink: true } },
  })
  await flushPromises()

  expect(page.text()).toContain('Office Wi-Fi')
  expect(page.text()).toContain('Host metrics')
  expect(page.text()).toContain('Wi-Fi (all wireless adapters)')
})

describe('monitor permission and runtime status composition', () => {
  it('shows policy, real probe failure, active, and independent offline states', async () => {
    apiMock.listTargets.mockResolvedValue([{
      id: 'mon-http', kind: 'http', name: 'Public site', target: 'https://example.com', params: {},
      enabled: true, all_agents: true, group_ids: [],
    }])
    apiMock.agents.mockResolvedValue([
      { id: 'blocked', display_name: 'Blocked Agent', status: 'offline' },
      { id: 'failed', display_name: 'Failed Agent', status: 'online' },
      { id: 'healthy', display_name: 'Healthy Agent', status: 'online' },
    ])
    apiMock.targetAgentStatus.mockResolvedValue([
      { agent_id: 'blocked', agent_name: 'Blocked Agent', monitor_id: 'mon-http', status: 'permission_blocked', missing_permissions: ['probe.http'] },
      { agent_id: 'failed', agent_name: 'Failed Agent', monitor_id: 'mon-http', status: 'active', missing_permissions: [] },
      { agent_id: 'healthy', agent_name: 'Healthy Agent', monitor_id: 'mon-http', status: 'active', missing_permissions: [] },
    ])
    apiMock.latest.mockImplementation((id: string) => Promise.resolve(
      id === 'failed'
        ? [{ kind: 'probe.http.ok', value: 0, monitor_id: 'mon-http' }]
        : id === 'healthy'
          ? [{ kind: 'probe.http.ok', value: 1, monitor_id: 'mon-http' }]
          : [],
    ))

    const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
    const page = mount(Monitoring, {
      global: { plugins: [i18n], stubs: { RouterLink: true } },
    })
    await flushPromises()

    const status = page.get('td.status')
    expect(status.text()).toContain('Permission blocked')
    expect(status.text()).toContain('Probe failed')
    expect(status.text()).toContain('Collecting')
    expect(status.text()).toContain('Agent offline')
    expect(status.findAll('[title="Blocked Agent"]').length).toBe(2)
    expect(status.find('[title="Failed Agent"]').exists()).toBe(true)
    expect(status.find('[title="Healthy Agent"]').exists()).toBe(true)
  })
})
