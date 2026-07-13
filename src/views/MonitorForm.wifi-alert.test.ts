import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import en from '../locales/en'
import MonitorForm from './MonitorForm.vue'
import type { ProbeTarget, Rule } from '../api'

const state = vi.hoisted(() => ({
  route: { path: '/monitoring/new-host', params: {} as Record<string, string>, query: {} as Record<string, unknown> },
  replace: vi.fn(),
  push: vi.fn(),
}))
const apiMock = vi.hoisted(() => ({
  listTargets: vi.fn(), channels: vi.fn(), agentGroups: vi.fn(), setTargets: vi.fn(),
  targetRules: vi.fn(), createTargetRule: vi.fn(), updateRule: vi.fn(), deleteRule: vi.fn(),
}))

vi.mock('../api', () => ({ api: apiMock }))
vi.mock('vue-router', () => ({
  useRoute: () => state.route,
  useRouter: () => ({ replace: state.replace, push: state.push }),
}))

async function render(targets: ProbeTarget[] = [], rules: Rule[] = []) {
  apiMock.listTargets.mockResolvedValue(targets)
  apiMock.channels.mockResolvedValue([])
  apiMock.agentGroups.mockResolvedValue([])
  apiMock.targetRules.mockResolvedValue(rules)
  apiMock.setTargets.mockResolvedValue(undefined)
  apiMock.createTargetRule.mockResolvedValue({ id: 'rule-new' })
  apiMock.updateRule.mockResolvedValue(undefined)
  apiMock.deleteRule.mockResolvedValue(undefined)
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
  it('saves Wi-Fi inside the host flow as a host/* anchor', async () => {
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
      expect.objectContaining({ kind: 'host', target: '*', enabled: true, all_agents: true }),
    ])
  })

  it('restores host/* as Wi-Fi and exposes only the three Wi-Fi presets', async () => {
    state.route.path = '/monitoring/wifi-anchor/edit'
    state.route.params = { id: 'wifi-anchor' }
    const target: ProbeTarget = {
      id: 'wifi-anchor', kind: 'host', name: 'Office Wi-Fi', target: '*', params: {},
      enabled: true, all_agents: true, group_ids: [],
    }
    const rule: Rule = {
      id: 'rule-signal', probe_task_id: 'wifi-anchor', name: 'Low signal',
      metric_kind: 'wifi.signal_dbm', comparator: 'lt', threshold: -70,
      fail_threshold: 3, for_seconds: 0, layer: 'wireless', severity: 'error',
      channel_ids: [], is_template: false, enabled: true,
    }
    const page = await render([target], [rule])

    const subject = page.get('select:disabled')
    expect((subject.element as HTMLSelectElement).value).toBe('wifi')

    const condition = page.findAll('select').find((select) => select.find('option[value="disconnected"]').exists())
    expect(condition).toBeTruthy()
    expect(condition!.findAll('option').map((option) => option.attributes('value'))).toEqual([
      'disconnected', 'signal', 'quality',
    ])
    expect(condition!.findAll('option').map((option) => option.text())).toEqual([
      'Wi-Fi disconnected', 'Wi-Fi signal strength below', 'Wi-Fi link quality below',
    ])
    expect((condition!.element as HTMLSelectElement).value).toBe('signal')
    expect((page.get('input.num:not(.sm)').element as HTMLInputElement).value).toBe('-70')
    expect(page.text()).toContain('dBm')
  })

  it('creates the default disconnected rule with wireless layer', async () => {
    state.route.path = '/monitoring/wifi-anchor/edit'
    state.route.params = { id: 'wifi-anchor' }
    const target: ProbeTarget = {
      id: 'wifi-anchor', kind: 'host', name: 'Office Wi-Fi', target: '*', params: {},
      enabled: true, all_agents: true, group_ids: [],
    }
    const page = await render([target])
    const add = page.findAll('button').find((button) => button.text() === '+ New rule')
    expect(add).toBeTruthy()

    await add!.trigger('click')
    await flushPromises()

    expect(apiMock.createTargetRule).toHaveBeenCalledWith('wifi-anchor', expect.objectContaining({
      metric_kind: 'wifi.up', comparator: 'lt', threshold: 1,
      fail_threshold: 3, layer: 'wireless', severity: 'error',
    }))
  })
})
