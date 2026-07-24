import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import en from '../locales/en'
import MonitorForm from './MonitorForm.vue'
import type { ProbeTarget } from '../api'

const state = vi.hoisted(() => ({
  route: { path: '/monitoring/new', params: {} as Record<string, string>, query: {} as Record<string, unknown> },
  replace: vi.fn(),
  push: vi.fn(),
}))
const apiMock = vi.hoisted(() => ({
  listTargets: vi.fn(), monitorGroups: vi.fn(), setTargets: vi.fn(),
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
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
  const page = mount(MonitorForm, {
    global: { plugins: [i18n], stubs: { RouterLink: true } },
  })
  await flushPromises()
  return page
}

function targetInput(page: ReturnType<typeof mount>) {
  return page.get('label.field.wide input')
}

beforeEach(() => {
  vi.clearAllMocks()
  state.route.path = '/monitoring/new'
  state.route.params = {}
  state.route.query = {}
})

describe('MonitorForm connection quick-add prefill', () => {
  it('prefills a normal TCP create without auto-saving', async () => {
    state.route.query = { kind: 'tcp', target: '1.1.1.1', port: '443' }
    const page = await render()

    expect((page.get('select').element as HTMLSelectElement).value).toBe('tcp')
    expect((targetInput(page).element as HTMLInputElement).value).toBe('1.1.1.1')
    expect((page.get('input[placeholder="443"]').element as HTMLInputElement).value).toBe('443')
    expect(apiMock.setTargets).not.toHaveBeenCalled()
  })

  it('prefills ICMP without carrying a TCP port', async () => {
    state.route.query = { kind: 'icmp', target: '9.9.9.9', port: '443' }
    const page = await render()

    expect((page.get('select').element as HTMLSelectElement).value).toBe('icmp')
    expect((targetInput(page).element as HTMLInputElement).value).toBe('9.9.9.9')
    expect(page.find('input[placeholder="443"]').exists()).toBe(false)
  })

  it('rejects unsupported kinds, repeated values, and invalid TCP ports', async () => {
    state.route.query = { kind: 'http', target: 'example.com', port: ['443'] }
    let page = await render()
    expect((page.get('select').element as HTMLSelectElement).value).toBe('icmp')
    expect((targetInput(page).element as HTMLInputElement).value).toBe('')
    page.unmount()

    vi.clearAllMocks()
    state.route.query = { kind: 'tcp', target: '1.1.1.1', port: '70000' }
    page = await render()
    expect((page.get('input[placeholder="443"]').element as HTMLInputElement).value).toBe('')
    page.unmount()
  })

  it('ignores query prefill while editing an existing monitor', async () => {
    state.route.path = '/monitoring/t1/edit'
    state.route.params = { id: 't1' }
    state.route.query = { kind: 'tcp', target: '1.1.1.1', port: '443' }
    const existing: ProbeTarget = {
      id: 't1', kind: 'icmp', name: 'Existing', target: '8.8.8.8', params: {},
      enabled: true, group_id: 'group-default',
    }
    const page = await render([existing])

    expect((page.get('select').element as HTMLSelectElement).value).toBe('icmp')
    expect((targetInput(page).element as HTMLInputElement).value).toBe('8.8.8.8')
  })

  it('ignores query prefill in the dedicated new-host flow', async () => {
    state.route.path = '/monitoring/new-host'
    state.route.query = { kind: 'tcp', target: '1.1.1.1', port: '443' }
    const page = await render()

    expect(page.get('h2').text()).toBe('Add host alert')
    expect(page.text()).not.toContain('TCP Port')
    expect(page.find('input[placeholder="443"]').exists()).toBe(false)
  })
})

// A <select> bound to an undefined param matches no <option> and renders blank;
// every per-kind dropdown must land on its first option instead.
describe('MonitorForm select defaults', () => {
  function selectFor(page: ReturnType<typeof mount>, label: string) {
    const field = page.findAll('label.field').find((f) => f.text().startsWith(label))
    if (!field) throw new Error(`no field labelled ${label}`)
    return field.get('select').element as HTMLSelectElement
  }

  it('selects the first option of every DNS dropdown', async () => {
    const page = await render()
    await page.get('select').setValue('dns')

    expect(selectFor(page, 'Resolver protocol').selectedIndex).toBe(0)
    expect(selectFor(page, 'Record type').selectedIndex).toBe(0)
  })

  it('selects the first option for HTTP and NAT dropdowns', async () => {
    const page = await render()

    await page.get('select').setValue('http')
    expect(selectFor(page, 'Method').selectedIndex).toBe(0)

    await page.get('select').setValue('nat')
    expect(selectFor(page, 'Transport').selectedIndex).toBe(0)
  })

  it('defaults the dropdowns of an existing monitor saved without them', async () => {
    state.route.path = '/monitoring/t1/edit'
    state.route.params = { id: 't1' }
    const existing: ProbeTarget = {
      id: 't1', kind: 'dns', name: 'DNS', target: 'example.com', params: {},
      enabled: true, group_id: 'group-default',
    }
    const page = await render([existing])

    expect(selectFor(page, 'Resolver protocol').selectedIndex).toBe(0)
    expect(selectFor(page, 'Record type').selectedIndex).toBe(0)
  })

  it('keeps the stored dropdown values when editing', async () => {
    state.route.path = '/monitoring/t1/edit'
    state.route.params = { id: 't1' }
    const existing: ProbeTarget = {
      id: 't1', kind: 'dns', name: 'DNS', target: 'example.com',
      params: { resolver_protocol: 'dot', record_type: 'MX' },
      enabled: true, group_id: 'group-default',
    }
    const page = await render([existing])

    expect(selectFor(page, 'Resolver protocol').value).toBe('dot')
    expect(selectFor(page, 'Record type').value).toBe('MX')
  })
})

describe('MonitorForm save navigation', () => {
  it('returns to the monitor list after a clean save', async () => {
    apiMock.setTargets.mockResolvedValue({ ok: true, warnings: [] })
    const page = await render()
    await targetInput(page).setValue('1.1.1.1')

    await page.get('button.btn.btn-primary').trigger('click')
    await flushPromises()

    expect(apiMock.setTargets).toHaveBeenCalledTimes(1)
    expect(state.push).toHaveBeenCalledWith('/monitoring')
  })

  it('stays on the form when the save reports a permission warning', async () => {
    const saved: ProbeTarget = {
      id: 'new-1', kind: 'icmp', name: '', target: '1.1.1.1', params: {},
      enabled: true, group_id: 'group-default',
    }
    apiMock.setTargets.mockResolvedValue({
      ok: true,
      warnings: [{
        monitor_id: 'new-1', monitor_name: '1.1.1.1', status: 'permission_blocked',
        affected_agents: 1, capable_agents: 0, missing_permissions: ['icmp'],
        blocked_agents: [{ agent_id: 'a1', agent_name: 'Agent 1', status: 'permission_blocked', missing_permissions: ['icmp'] }],
        capable_agent_list: [],
      }],
    })
    const page = await render()
    await targetInput(page).setValue('1.1.1.1')
    // Second listTargets call (post-save reload) returns the created monitor.
    apiMock.listTargets.mockResolvedValue([saved])

    await page.get('button.btn.btn-primary').trigger('click')
    await flushPromises()

    expect(state.push).not.toHaveBeenCalled()
    expect(state.replace).toHaveBeenCalledWith('/monitoring/new-1/edit')
    expect(page.find('.save-warn').exists()).toBe(true)
  })
})
