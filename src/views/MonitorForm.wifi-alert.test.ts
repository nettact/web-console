import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import en from '../locales/en'
import MonitorForm from './MonitorForm.vue'
import type { ProbeTarget } from '../api'

const state = vi.hoisted(() => ({
  route: { path: '/monitoring/new-host', params: {} as Record<string, string>, query: {} as Record<string, unknown> },
  replace: vi.fn(),
  push: vi.fn(),
}))
const apiMock = vi.hoisted(() => ({
  listTargets: vi.fn(), monitorGroups: vi.fn(), setTargets: vi.fn(), channels: vi.fn(), proxies: vi.fn(),
  detectionSettings: vi.fn(), updateDetectionSettings: vi.fn(),
}))

vi.mock('../api', () => ({ api: apiMock }))
vi.mock('vue-router', () => ({
  useRoute: () => state.route,
  useRouter: () => ({ replace: state.replace, push: state.push }),
}))

async function render(targets: ProbeTarget[] = []) {
  apiMock.listTargets.mockResolvedValue(targets)
  apiMock.monitorGroups.mockResolvedValue([{
    id: 'group-default', site_id: 'site_default', name: 'Default', is_default: true,
    merge_enabled: true, all_agents: true, agent_group_ids: [],
  }])
  apiMock.setTargets.mockResolvedValue({ ok: true, warnings: [] })
  apiMock.channels.mockResolvedValue([])
  apiMock.proxies.mockResolvedValue([])
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
  const page = mount(MonitorForm, {
    global: { plugins: [i18n], stubs: { RouterLink: true } },
  })
  await flushPromises()
  return page
}

beforeEach(() => {
  vi.clearAllMocks()
  state.route.path = '/monitoring/new-host'
  state.route.params = {}
  state.route.query = {}
})

describe('MonitorForm Wi-Fi system-status subject', () => {
  it('saves Wi-Fi as a host/* anchor in the selected monitor group', async () => {
    const page = await render()
    const subject = page.get('select')

    expect((subject.element as HTMLSelectElement).value).toBe('whole')
    await subject.setValue('wifi')
    expect(page.text()).toContain('every wireless adapter')

    await page.get('button.btn.btn-primary').trigger('click')
    await flushPromises()

    expect(apiMock.setTargets).toHaveBeenCalledTimes(1)
    expect(apiMock.setTargets.mock.calls[0][0]).toBe('site_default')
    expect(apiMock.setTargets.mock.calls[0][1]).toEqual([
      expect.objectContaining({ kind: 'host', target: '*', enabled: true, group_id: 'group-default' }),
    ])
  })

  it('restores host/* as the Wi-Fi subject without target-level alarm controls', async () => {
    state.route.path = '/monitoring/wifi-anchor/edit'
    state.route.params = { id: 'wifi-anchor' }
    const target: ProbeTarget = {
      id: 'wifi-anchor', group_id: 'group-default', kind: 'host', name: 'Office Wi-Fi', target: '*', params: {}, enabled: true,
    }
    const page = await render([target])

    const subject = page.get('select')
    expect((subject.element as HTMLSelectElement).value).toBe('wifi')
    expect(page.text()).not.toContain('+ New rule')
    // Alarm behaviour is owned by the monitor group, never by the target form.
    expect(page.text()).toContain(en.mform.groupManageHint)
  })
})
