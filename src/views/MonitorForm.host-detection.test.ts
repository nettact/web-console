import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import en from '../locales/en'
import MonitorForm from './MonitorForm.vue'
import type { HostDetection, ProbeTarget } from '../api'

const state = vi.hoisted(() => ({
  route: { path: '/monitoring/new-host', params: {} as Record<string, string>, query: {} as Record<string, unknown> },
  replace: vi.fn(),
  push: vi.fn(),
}))
const apiMock = vi.hoisted(() => ({
  listTargets: vi.fn(), monitorGroups: vi.fn(), setTargets: vi.fn(), channels: vi.fn(), proxies: vi.fn(),
  detectionSettings: vi.fn(), updateDetectionSettings: vi.fn(),
  hostDetection: vi.fn(), updateHostDetection: vi.fn(),
}))

vi.mock('../api', () => ({ api: apiMock }))
vi.mock('vue-router', () => ({
  useRoute: () => state.route,
  useRouter: () => ({ replace: state.replace, push: state.push }),
}))

function defaults(overrides: Partial<HostDetection> = {}): HostDetection {
  return {
    target_id: 'h1',
    cpu: { enabled: true, pct: 90, duration_s: 300 },
    mem: { enabled: true, pct: 90, duration_s: 300 },
    load: { enabled: true, per_core: 2, duration_s: 300 },
    net: { enabled: false, rx_mbps: null, tx_mbps: null, duration_s: 300 },
    disk: { enabled: true, pct: 90 },
    revision: 1,
    ...overrides,
  }
}

async function render(targets: ProbeTarget[] = [], detection?: HostDetection) {
  apiMock.listTargets.mockResolvedValue(targets)
  apiMock.monitorGroups.mockResolvedValue([{
    id: 'group-default', site_id: 'site_default', name: 'Default', is_default: true,
    merge_enabled: true, all_agents: true, agent_group_ids: [],
  }])
  apiMock.setTargets.mockResolvedValue({ ok: true, warnings: [] })
  apiMock.channels.mockResolvedValue([])
  apiMock.proxies.mockResolvedValue([])
  apiMock.hostDetection.mockResolvedValue(detection ?? defaults())
  apiMock.updateHostDetection.mockImplementation(async (_id: string, body: unknown) =>
    ({ ...defaults(), ...(body as object), revision: 2 }))
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

describe('MonitorForm system-status mode', () => {
  // A host anchor watches the whole machine. It used to pick one subject —
  // whole / a disk / Wi-Fi — because the deleted rule engine bound each rule to
  // one series; nothing about the form should offer that choice any more.
  it('saves a host anchor with the fixed whole-machine target', async () => {
    const page = await render()

    expect(page.text()).not.toContain('What to monitor')
    expect(page.text()).toContain(en.mform.hostDet.title)

    await page.get('button.btn.btn-primary').trigger('click')
    await flushPromises()

    expect(apiMock.setTargets).toHaveBeenCalledTimes(1)
    expect(apiMock.setTargets.mock.calls[0][1]).toEqual([
      expect.objectContaining({ kind: 'host', target: 'host', enabled: true, group_id: 'group-default' }),
    ])
  })

  // Every family is visible without opening anything: this IS the editor for a
  // host monitor, and an editor behind a disclosure is a feature nobody finds.
  it('shows all five families at once', async () => {
    state.route.path = '/monitoring/h1/edit'
    state.route.params = { id: 'h1' }
    const target: ProbeTarget = {
      id: 'h1', group_id: 'group-default', kind: 'host', name: 'Server', target: 'host', params: {}, enabled: true,
    }
    const page = await render([target])

    for (const key of ['cpuTitle', 'memTitle', 'loadTitle', 'diskTitle', 'netTitle'] as const) {
      expect(page.text()).toContain(en.mform.hostDet[key])
    }
    // Sensitivity (round counts) belongs to probe targets; a host anchor has no
    // probe and no rounds to count.
    expect(page.text()).not.toContain(en.mform.detectionTitle)
  })

  // The thresholds hang off the anchor's id, so they are written only after the
  // anchor itself is saved — the same two-step the probe sensitivity uses.
  it('writes thresholds after the anchor is saved, and only when they changed', async () => {
    state.route.path = '/monitoring/h1/edit'
    state.route.params = { id: 'h1' }
    const target: ProbeTarget = {
      id: 'h1', group_id: 'group-default', kind: 'host', name: 'Server', target: 'host', params: {}, enabled: true,
    }
    const page = await render([target])

    // Untouched: saving the anchor must not bump the revision that resets every
    // running streak.
    await page.get('button.btn.btn-primary').trigger('click')
    await flushPromises()
    expect(apiMock.updateHostDetection).not.toHaveBeenCalled()

    const cpuSelect = page.findAll('.host-sentence select')[0]
    await cpuSelect.setValue('95')
    await page.get('button.btn.btn-primary').trigger('click')
    await flushPromises()

    expect(apiMock.setTargets).toHaveBeenCalledTimes(2)
    expect(apiMock.updateHostDetection).toHaveBeenCalledTimes(1)
    expect(apiMock.updateHostDetection.mock.calls[0][0]).toBe('h1')
    expect(apiMock.updateHostDetection.mock.calls[0][1]).toMatchObject({
      cpu: { enabled: true, pct: 95 },
    })
  })

  // Enabling network alerting with neither direction set would be an alert the
  // form shows as on and the server treats as off.
  it('refuses network alerting with no direction set', async () => {
    const page = await render()
    // Network is the last row; picked by position from the end so inserting a
    // family above it does not silently retarget this test at a different one.
    const rows = page.findAll('.host-row')
    const netToggle = rows[rows.length - 1].get('.check-row input')
    expect(rows[rows.length - 1].text()).toContain(en.mform.hostDet.netTitle)
    await netToggle.setValue(true)

    await page.get('button.btn.btn-primary').trigger('click')
    await flushPromises()

    expect(apiMock.setTargets).not.toHaveBeenCalled()
    expect(page.text()).toContain(en.mform.hostDet.errNetDirection)
  })

  // A value the server holds that is not one of our presets must stay visible
  // and editable rather than silently snapping to the nearest offered one.
  it('opens a custom field for a threshold outside the presets', async () => {
    state.route.path = '/monitoring/h1/edit'
    state.route.params = { id: 'h1' }
    const target: ProbeTarget = {
      id: 'h1', group_id: 'group-default', kind: 'host', name: 'Server', target: 'host', params: {}, enabled: true,
    }
    const page = await render([target], defaults({ cpu: { enabled: true, pct: 73, duration_s: 300 } }))

    const custom = page.find('.host-custom input')
    expect(custom.exists()).toBe(true)
    expect((custom.element as HTMLInputElement).value).toBe('73')
  })
})

// The two hydration hazards. A host anchor's panel is BOUND to the client-side
// defaults until its stored thresholds arrive, so anything that lets the user
// edit or save before then writes values nobody chose over the real ones.
describe('MonitorForm system-status hydration', () => {
  const hostTarget: ProbeTarget = {
    id: 'h1', group_id: 'group-default', kind: 'host', name: 'Server', target: 'host', params: {}, enabled: true,
  }

  it('keeps the panel and Save out of use until the thresholds arrive', async () => {
    state.route.path = '/monitoring/h1/edit'
    state.route.params = { id: 'h1' }
    // A GET that never settles: the form must not offer the defaults as editable.
    apiMock.hostDetection.mockReturnValue(new Promise(() => {}))
    apiMock.listTargets.mockResolvedValue([hostTarget])
    apiMock.monitorGroups.mockResolvedValue([{
      id: 'group-default', site_id: 'site_default', name: 'Default', is_default: true,
      merge_enabled: true, all_agents: true, agent_group_ids: [],
    }])
    apiMock.setTargets.mockResolvedValue({ ok: true, warnings: [] })
    apiMock.channels.mockResolvedValue([])
    apiMock.proxies.mockResolvedValue([])
    const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
    const page = mount(MonitorForm, { global: { plugins: [i18n], stubs: { RouterLink: true } } })
    await flushPromises()

    expect(page.findAll('.host-row')).toHaveLength(0)
    expect(page.text()).toContain(en.mform.hostDet.loading)

    await page.get('button.btn.btn-primary').trigger('click')
    await flushPromises()
    expect(apiMock.setTargets).not.toHaveBeenCalled()
    expect(apiMock.updateHostDetection).not.toHaveBeenCalled()
  })

  it('reports a failed read instead of passing the defaults off as stored', async () => {
    state.route.path = '/monitoring/h1/edit'
    state.route.params = { id: 'h1' }
    apiMock.listTargets.mockResolvedValue([hostTarget])
    apiMock.monitorGroups.mockResolvedValue([{
      id: 'group-default', site_id: 'site_default', name: 'Default', is_default: true,
      merge_enabled: true, all_agents: true, agent_group_ids: [],
    }])
    apiMock.setTargets.mockResolvedValue({ ok: true, warnings: [] })
    apiMock.channels.mockResolvedValue([])
    apiMock.proxies.mockResolvedValue([])
    apiMock.hostDetection.mockRejectedValue(new Error('500 internal'))
    const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
    const page = mount(MonitorForm, { global: { plugins: [i18n], stubs: { RouterLink: true } } })
    await flushPromises()

    expect(page.text()).toContain('500 internal')
    expect(page.findAll('.host-row')).toHaveLength(0)

    await page.get('button.btn.btn-primary').trigger('click')
    await flushPromises()
    expect(apiMock.setTargets).not.toHaveBeenCalled()
  })

  // A CREATE has nothing stored to wait for, so it must not be blocked by the
  // same guard.
  it('lets a new anchor be edited and saved immediately', async () => {
    const page = await render()
    expect(page.findAll('.host-row').length).toBeGreaterThan(0)
    await page.get('button.btn.btn-primary').trigger('click')
    await flushPromises()
    expect(apiMock.setTargets).toHaveBeenCalledTimes(1)
  })
})

// The value-handling hazards the second review round found.
describe('MonitorForm system-status value handling', () => {
  const stored: ProbeTarget = {
    id: 'h1', group_id: 'group-default', kind: 'host', name: 'Server', target: 'host', params: {}, enabled: true,
  }
  // The PATCH only runs once the anchor has an id, so the assertions about its
  // body use the edit flow.
  async function editing() {
    state.route.path = '/monitoring/h1/edit'
    state.route.params = { id: 'h1' }
    return render([stored])
  }

  it('refuses an invalid network rate instead of silently discarding it', async () => {
    const page = await render()
    const rows = page.findAll('.host-row')
    await rows[rows.length - 1].get('.check-row input').setValue(true)

    const [rx, tx] = page.findAll('.host-net-grid input')
    await rx.setValue('100')
    await tx.setValue('0') // not a threshold, and not a blank either

    await page.get('button.btn.btn-primary').trigger('click')
    await flushPromises()

    expect(apiMock.setTargets).not.toHaveBeenCalled()
    expect(page.text()).toContain(en.mform.hostDet.errNetRate)
  })

  it('treats a blank direction as unwatched rather than invalid', async () => {
    const page = await editing()
    const rows = page.findAll('.host-row')
    await rows[rows.length - 1].get('.check-row input').setValue(true)
    const [rx] = page.findAll('.host-net-grid input')
    await rx.setValue('100')

    await page.get('button.btn.btn-primary').trigger('click')
    await flushPromises()

    expect(apiMock.setTargets).toHaveBeenCalledTimes(1)
    expect(apiMock.updateHostDetection.mock.calls[0][1]).toMatchObject({
      net: { enabled: true, rx_mbps: 100, tx_mbps: null },
    })
  })

  // A family that is off has no visible controls, so a stale value inside it must
  // not block Save with an error pointing at a field nobody can see.
  it('does not validate a family that is switched off', async () => {
    const page = await render()
    const cpuCustom = page.findAll('.host-sentence select')[0]
    await cpuCustom.setValue('custom')
    await page.get('.host-custom input').setValue('0') // invalid while enabled

    await page.get('button.btn.btn-primary').trigger('click')
    await flushPromises()
    expect(apiMock.setTargets).not.toHaveBeenCalled()

    await page.findAll('.host-row')[0].get('.check-row input').setValue(false)
    await page.get('button.btn.btn-primary').trigger('click')
    await flushPromises()
    expect(apiMock.setTargets).toHaveBeenCalledTimes(1)
  })

  // Durations are seconds on the wire and minutes on screen.
  it('enters a custom duration in minutes and sends seconds', async () => {
    const page = await editing()
    const durationSelect = page.findAll('.host-sentence select')[1]
    await durationSelect.setValue('custom')
    const box = page.get('.host-custom input')
    expect((box.element as HTMLInputElement).value).toBe('5') // 300s shown as 5 min
    await box.setValue('2')

    await page.get('button.btn.btn-primary').trigger('click')
    await flushPromises()
    expect(apiMock.updateHostDetection.mock.calls[0][1]).toMatchObject({
      cpu: { duration_s: 120 },
    })
  })
})
