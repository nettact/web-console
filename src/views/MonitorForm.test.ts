import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
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
  listTargets: vi.fn(), monitorGroups: vi.fn(), setTargets: vi.fn(), channels: vi.fn(), proxies: vi.fn(),
  detectionSettings: vi.fn(), updateDetectionSettings: vi.fn(),
  notificationPolicies: vi.fn(), createNotificationPolicy: vi.fn(),
  updateNotificationPolicy: vi.fn(), deleteNotificationPolicy: vi.fn(),
}))

vi.mock('../api', () => ({ api: apiMock }))
vi.mock('vue-router', () => ({
  useRoute: () => state.route,
  useRouter: () => ({ replace: state.replace, push: state.push }),
}))

function detection(over: Record<string, unknown> = {}) {
  return { target_id: 't1', kind: 'icmp', profile: 'balanced', fail_rounds: 3, recover_rounds: 2, icmp_loss_pct: 100, smart_enabled: true, smart_sensitivity: 'standard', revision: 1, ...over }
}

// The panel now holds two radio groups that share a style class: the availability
// profiles inside the advanced disclosure, and the smart sensitivity levels above
// it. Selectors are scoped to their container so a test can never assert against
// the wrong group.
const editableIcmpTarget: ProbeTarget = {
  id: 't1', kind: 'icmp', name: 'Router', target: '192.168.1.1', params: {},
  enabled: true, group_id: 'group-default',
}
const profileRadios = (page: VueWrapper) => page.findAll('.det-body .profile-opt input')
const smartRadios = (page: VueWrapper) => page.findAll('.smart-list .profile-opt input')

async function render(targets: ProbeTarget[] = [], det = detection()) {
  apiMock.listTargets.mockResolvedValue(targets)
  apiMock.monitorGroups.mockResolvedValue([{
    id: 'group-default', site_id: 'site_default', name: 'Default', is_default: true,
    merge_enabled: true, all_agents: true, agent_group_ids: [],
  }])
  apiMock.channels.mockResolvedValue([])
  apiMock.proxies.mockResolvedValue([])
  apiMock.detectionSettings.mockResolvedValue(det)
  apiMock.updateDetectionSettings.mockImplementation((_id: string, body: Record<string, unknown>) =>
    Promise.resolve({ ...detection(), ...body }),
  )
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

    expect(page.get('h2').text()).toBe('Add system status alert')
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

describe('MonitorForm section order', () => {
  it.each([
    ['icmp', '1.1.1.1'],
    ['http', 'https://example.com'],
    ['tcp', 'example.com'],
    ['dns', 'example.com'],
    ['nat', 'stun.example.com'],
    ['gateway', 'gateway'],
    ['host', 'host'],
  ])('places the monitor group last when editing a %s target', async (kind, target) => {
    state.route.path = '/monitoring/t1/edit'
    state.route.params = { id: 't1' }
    const existing: ProbeTarget = {
      id: 't1', kind, name: 'Existing', target, params: {},
      enabled: true, group_id: 'group-default',
    }
    const page = await render([existing])
    const headings = page.findAll('section.panel h3').map((heading) => heading.text())

    expect(headings[headings.length - 1]).toBe('Monitor group')
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

  // A scheme-less URL is what Go's HTTP client refuses outright, so the form
  // normalizes it the way the server does — and shows the user the result.
  it('normalizes a scheme-less HTTP url on blur and on save', async () => {
    apiMock.setTargets.mockResolvedValue({ ok: true, warnings: [] })
    const page = await render()
    await page.get('select').setValue('http')
    const input = targetInput(page)
    await input.setValue('www.yahoo.co.jp')
    await input.trigger('blur')

    expect((input.element as HTMLInputElement).value).toBe('https://www.yahoo.co.jp')

    await page.get('button.btn.btn-primary').trigger('click')
    await flushPromises()

    const saved = apiMock.setTargets.mock.calls[0][1] as ProbeTarget[]
    expect(saved[saved.length - 1].target).toBe('https://www.yahoo.co.jp')
  })

  // "://" further along the URL belongs to the path or query — the target itself
  // is still scheme-less and must be normalized.
  it('normalizes a scheme-less url that embeds an absolute url', async () => {
    apiMock.setTargets.mockResolvedValue({ ok: true, warnings: [] })
    const page = await render()
    await page.get('select').setValue('http')
    const input = targetInput(page)
    await input.setValue('example.com/login?next=https://idp.example')
    await input.trigger('blur')

    expect((input.element as HTMLInputElement).value).toBe('https://example.com/login?next=https://idp.example')
  })

  // The reported bug: switching http → dns kept the URL, saved happily, and then
  // failed every probe. The target is now carried across into the new kind's shape.
  it('converts the url to a hostname when switching from http to dns', async () => {
    apiMock.setTargets.mockResolvedValue({ ok: true, warnings: [] })
    const page = await render()
    await page.get('select').setValue('http')
    const input = targetInput(page)
    await input.setValue('www.yahoo.co.jp')
    await input.trigger('blur')
    expect((input.element as HTMLInputElement).value).toBe('https://www.yahoo.co.jp')

    await page.get('select').setValue('dns')

    expect((targetInput(page).element as HTMLInputElement).value).toBe('www.yahoo.co.jp')
    expect(page.find('.field-err').exists()).toBe(false)
  })

  // A shape the probe could never dial must be reported at the field, and must
  // not reach the server as a monitor that fails forever.
  it('blocks the save and flags the field when the target shape is wrong for the kind', async () => {
    apiMock.setTargets.mockResolvedValue({ ok: true, warnings: [] })
    const page = await render()
    await page.get('select').setValue('dns')
    // Typed by hand rather than carried over, so no conversion applies.
    await targetInput(page).setValue('example.com/health')
    await flushPromises()

    expect(page.get('.field-err').text()).toBe(en.mform.errHostPath)

    await page.get('button.btn.btn-primary').trigger('click')
    await flushPromises()

    expect(apiMock.setTargets).not.toHaveBeenCalled()
    expect(state.push).not.toHaveBeenCalled()
  })

  // min/max on the inputs are advisory only — this form saves from a button
  // click, so the browser never runs constraint validation.
  it('blocks the save when a numeric param is out of the range the server accepts', async () => {
    apiMock.setTargets.mockResolvedValue({ ok: true, warnings: [] })
    const page = await render()
    await targetInput(page).setValue('1.1.1.1') // icmp is the default kind
    await page.get('input[placeholder="5"]').setValue('101') // packet_count, max 100
    await flushPromises()

    await page.get('button.btn.btn-primary').trigger('click')
    await flushPromises()

    expect(apiMock.setTargets).not.toHaveBeenCalled()
    const shown = page.get('.err').text()
    expect(shown).toContain(en.mform.packetCount) // names the offending field
    expect(shown).toContain('100') // and the bound it broke
  })

  // timeout_ms is one field with two meanings — for the ping kinds it bounds a
  // single echo, everywhere else a whole request. Both labels rendering at once
  // put two inputs on the same value, so each kind must show exactly one.
  it('shows one timeout control per kind, labelled for that kind', async () => {
    const labels = (page: ReturnType<typeof mount>) => page.findAll('label.field span').map((s) => s.text())

    for (const kind of ['icmp', 'gateway']) {
      const page = await render()
      await page.get('select').setValue(kind)
      await flushPromises()
      expect(labels(page)).toContain(en.mform.perPingTimeout)
      expect(labels(page)).not.toContain(en.mform.timeout)
      page.unmount()
    }

    const page = await render()
    await page.get('select').setValue('http')
    await flushPromises()
    expect(labels(page)).toContain(en.mform.timeout)
    expect(labels(page)).not.toContain(en.mform.perPingTimeout)
  })

  // DEGRADE-001/002: the size-sweep checkbox rides with the ping kinds, the
  // source-port fan-out input with TCP — each only in its own advanced block.
  it('shows the degradation controls only for the kinds that run them', async () => {
    // Field names render as a direct span in label.field, and as the <strong>
    // title inside a label.check-row (the size-sweep checkbox's explanatory row).
    const labels = (page: ReturnType<typeof mount>) =>
      page.findAll('label.field span, label.check-row strong').map((s) => s.text())

    for (const kind of ['icmp', 'gateway']) {
      const page = await render()
      await page.get('select').setValue(kind)
      await flushPromises()
      expect(labels(page)).toContain(en.mform.sizeSweep)
      expect(page.find('input[min="0"][max="32"]').exists()).toBe(false)
      page.unmount()
    }

    const page = await render()
    await page.get('select').setValue('tcp')
    await flushPromises()
    expect(labels(page)).toContain(en.mform.tcpFlowFanout)
    // The fan-out input carries the probevalidate.go bounds as min/max + the off
    // default as its placeholder.
    const fanout = page.get('input[min="0"][max="32"]')
    expect((fanout.element as HTMLInputElement).placeholder).toBe('0')
    expect(labels(page)).not.toContain(en.mform.sizeSweep)
  })

  it('leaves an already-schemed url untouched', async () => {
    apiMock.setTargets.mockResolvedValue({ ok: true, warnings: [] })
    const page = await render()
    await page.get('select').setValue('http')
    const input = targetInput(page)
    await input.setValue('http://example.com/a')
    await input.trigger('blur')

    expect((input.element as HTMLInputElement).value).toBe('http://example.com/a')
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

// The built-in detector has no off switch: the form only tunes its sensitivity,
// and the settings hang off the target's id, so they are written after the save.
describe('MonitorForm detection sensitivity', () => {
  it('does not expose or call a target notification policy', async () => {
    apiMock.setTargets.mockResolvedValue({ ok: true, warnings: [] })
    const page = await render()

    expect(page.findAll('h3').some((h) => h.text() === 'Notification policy')).toBe(false)
    expect(apiMock.notificationPolicies).not.toHaveBeenCalled()

    await targetInput(page).setValue('1.1.1.1')
    await page.get('button.btn.btn-primary').trigger('click')
    await flushPromises()

    expect(apiMock.createNotificationPolicy).not.toHaveBeenCalled()
    expect(apiMock.updateNotificationPolicy).not.toHaveBeenCalled()
    expect(apiMock.deleteNotificationPolicy).not.toHaveBeenCalled()
  })

  it('places detection sensitivity immediately before the final monitor group panel', async () => {
    const page = await render()
    for (const kind of ['icmp', 'gateway', 'http', 'tcp', 'dns', 'nat']) {
      await page.get('select').setValue(kind)
      await flushPromises()

      const panels = page.findAll('section.panel')
      expect(panels.length).toBeGreaterThan(1)
      expect(panels[panels.length - 2].find('.det-summary').exists()).toBe(true)
      expect(panels[panels.length - 1].get('h3').text()).toBe('Monitor group')
    }
  })

  it('keeps the packet-loss explanation beneath its threshold input', async () => {
    const page = await render()
    const lossField = page.get('.det-grid label.field')

    expect(lossField.find('input[type="number"]').exists()).toBe(true)
    expect(lossField.get('small.hint').text()).toContain('A round counts as failed')
    expect(page.find('.det-grid > .hint').exists()).toBe(false)
  })

  it('writes the chosen profile once the created target has an id', async () => {
    apiMock.setTargets.mockResolvedValue({ ok: true, warnings: [] })
    const page = await render()
    await targetInput(page).setValue('1.1.1.1')
    // 0 = balanced, 1 = fast, 2 = stable, 3 = custom
    await profileRadios(page)[1].setValue()
    apiMock.listTargets.mockResolvedValue([{
      id: 'new-1', kind: 'icmp', name: '', target: '1.1.1.1', params: {},
      enabled: true, group_id: 'group-default',
    }])

    await page.get('button.btn.btn-primary').trigger('click')
    await flushPromises()

    expect(apiMock.updateDetectionSettings).toHaveBeenCalledWith('new-1', {
      profile: 'fast', fail_rounds: 2, recover_rounds: 2, icmp_loss_pct: 100,
      smart_enabled: true, smart_sensitivity: 'standard',
    })
    expect(state.push).toHaveBeenCalledWith('/monitoring')
  })

  it('leaves the settings untouched when the sensitivity was not changed', async () => {
    apiMock.setTargets.mockResolvedValue({ ok: true, warnings: [] })
    const page = await render()
    await targetInput(page).setValue('1.1.1.1')

    await page.get('button.btn.btn-primary').trigger('click')
    await flushPromises()

    expect(apiMock.updateDetectionSettings).not.toHaveBeenCalled()
  })

  it('loads the stored sensitivity when editing and states it in the summary', async () => {
    state.route.path = '/monitoring/t1/edit'
    state.route.params = { id: 't1' }
    const page = await render(
      [{
        id: 't1', kind: 'icmp', name: 'Router', target: '192.168.1.1', params: {},
        enabled: true, group_id: 'group-default',
      }],
      detection({ profile: 'stable', fail_rounds: 5, recover_rounds: 3 }),
    )

    expect(apiMock.detectionSettings).toHaveBeenCalledWith('t1')
    expect(page.find('.det-summary').exists()).toBe(true)
    // 2 = stable, the stored profile.
    expect((profileRadios(page)[2].element as HTMLInputElement).checked).toBe(true)
  })

  // host targets carry no availability detector, so there is nothing to tune.
  it('hides the sensitivity block for host targets', async () => {
    state.route.path = '/monitoring/new-host'
    const page = await render()

    expect(page.find('.det-summary').exists()).toBe(false)
    expect(apiMock.detectionSettings).not.toHaveBeenCalled()
  })
})

// Smart detection judges a target against its own history. Unlike the
// availability profiles it can be switched off, and unlike them its levels are
// never expressed as numbers — the multipliers behind them are not something a
// user could calibrate by eye.
describe('MonitorForm smart detection', () => {
  it('keeps the toggle visible rather than hiding it behind the disclosure', async () => {
    const page = await render()

    // Outside <details class="advanced">: discovering this feature must not
    // require expanding anything.
    expect(page.find('.smart-body').exists()).toBe(true)
    expect(page.find('.advanced .smart-body').exists()).toBe(false)
    expect(page.find('.smart-body input[type="checkbox"]').exists()).toBe(true)
    expect(smartRadios(page)).toHaveLength(3)
  })

  it('states no raw numbers in the level descriptions', async () => {
    const page = await render()
    for (const desc of page.findAll('.smart-list .profile-desc')) {
      expect(desc.text()).not.toMatch(/\d/)
    }
  })

  it('hides the levels when smart detection is switched off', async () => {
    state.route.path = '/monitoring/t1/edit'
    state.route.params = { id: 't1' }
    const page = await render([editableIcmpTarget], detection({ smart_enabled: false }))
    expect(page.find('.smart-list').exists()).toBe(false)
  })

  it('loads the stored level and writes a changed one', async () => {
    state.route.path = '/monitoring/t1/edit'
    state.route.params = { id: 't1' }
    apiMock.setTargets.mockResolvedValue({ ok: true, warnings: [] })
    const page = await render([editableIcmpTarget], detection({ smart_sensitivity: 'sensitive' }))
    // 0 = loose, 1 = standard, 2 = sensitive
    expect((smartRadios(page)[2].element as HTMLInputElement).checked).toBe(true)

    await smartRadios(page)[0].setValue()
    await page.get('button.btn.btn-primary').trigger('click')
    await flushPromises()

    expect(apiMock.updateDetectionSettings).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ smart_enabled: true, smart_sensitivity: 'loose' }),
    )
  })

  it('says so when a custom loss threshold has stood the loss check down', async () => {
    state.route.path = '/monitoring/t1/edit'
    state.route.params = { id: 't1' }
    const page = await render([editableIcmpTarget], detection({ profile: 'custom', icmp_loss_pct: 30 }))
    expect(page.get('.smart-body').text()).toContain('smart loss detection stands down')
  })
})
