import { expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import en from '../locales/en'
import Monitoring from './Monitoring.vue'

const apiMock = vi.hoisted(() => ({
  listTargets: vi.fn(), agentGroups: vi.fn(), setTargets: vi.fn(),
  purgeMonitor: vi.fn(), purgeTarget: vi.fn(),
}))

vi.mock('../api', () => ({ api: apiMock }))

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

