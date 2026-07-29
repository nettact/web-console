import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import en from '../locales/en'
import type { ProbeTarget, Proxy } from '../api'

const state = vi.hoisted(() => ({
  route: { params: {} as Record<string, string>, path: '/monitoring/new', query: {} as Record<string, string> },
  push: vi.fn(),
  replace: vi.fn(),
}))
const apiMock = vi.hoisted(() => ({
  listTargets: vi.fn(), monitorGroups: vi.fn(), setTargets: vi.fn(), channels: vi.fn(), proxies: vi.fn(),
  detectionSettings: vi.fn(), updateDetectionSettings: vi.fn(),
}))

vi.mock('../api', async () => {
  // REDACTED_SECRET is a real constant the component compares against, so the module
  // is partially mocked rather than replaced wholesale.
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, api: apiMock }
})
vi.mock('vue-router', () => ({
  useRoute: () => state.route,
  useRouter: () => ({ replace: state.replace, push: state.push }),
  RouterLink: { template: '<a><slot /></a>' },
}))

const proxy = (over: Partial<Proxy>): Proxy => ({
  id: 'p', site_id: 'site_default', name: 'p', type: 'socks5', enabled: true, used_by: 0, ...over,
})

async function render(proxies: Proxy[], targets: ProbeTarget[] = []) {
  apiMock.listTargets.mockResolvedValue(targets)
  apiMock.monitorGroups.mockResolvedValue([{
    id: 'group-default', site_id: 'site_default', name: 'Default', is_default: true,
    merge_enabled: true, all_agents: true, agent_group_ids: [],
  }])
  apiMock.channels.mockResolvedValue([])
  apiMock.proxies.mockResolvedValue(proxies)
  apiMock.detectionSettings.mockResolvedValue({
    target_id: 't1', kind: 'icmp', profile: 'balanced', fail_rounds: 3,
    recover_rounds: 2, icmp_loss_pct: 100, revision: 1,
  })
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
  const MonitorForm = (await import('./MonitorForm.vue')).default
  const page = mount(MonitorForm, {
    global: { plugins: [i18n], stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  })
  await flushPromises()
  return page
}

// The proxy <select> is identified by its label so the assertion does not depend on
// the panel's position among the others.
function proxySelect(page: Awaited<ReturnType<typeof render>>) {
  for (const label of page.findAll('label.field')) {
    if (label.find('span').text() === 'Proxy') return label.find('select')
  }
  return null
}

function kindSelect(page: Awaited<ReturnType<typeof render>>) {
  return page.get('select')
}

beforeEach(() => {
  vi.clearAllMocks()
  state.route = { params: {}, path: '/monitoring/new', query: {} }
})

describe('MonitorForm egress proxy', () => {
  it('offers only proxies whose transport can carry the monitor kind', async () => {
    const page = await render([
      proxy({ id: 'socks', name: 'Office', type: 'socks5' }),
      proxy({ id: 'wg', name: 'Tunnel', type: 'wireguard' }),
    ])
    // Default kind is icmp, which only a tunnel can carry.
    const sel = proxySelect(page)
    expect(sel).not.toBeNull()
    const icmpOptions = sel!.findAll('option').map((o) => o.attributes('value'))
    expect(icmpOptions).toEqual(['', 'wg'])

    // Switching to HTTP makes the relay usable too.
    await kindSelect(page).setValue('http')
    await flushPromises()
    const httpOptions = proxySelect(page)!.findAll('option').map((o) => o.attributes('value'))
    expect(httpOptions).toEqual(['', 'socks', 'wg'])
  })

  it('hides the panel for kinds no proxy can carry', async () => {
    const page = await render([proxy({ id: 'wg', type: 'wireguard' })])
    expect(proxySelect(page)).not.toBeNull()
    // A gateway monitor targets the local first hop; an egress proxy has no meaning.
    await kindSelect(page).setValue('gateway')
    await flushPromises()
    expect(proxySelect(page)).toBeNull()
  })

  it('never offers a disabled proxy', async () => {
    // A disabled proxy is dropped from the config push, so pinning one would fail the
    // monitor closed — it must not be selectable in the first place.
    const page = await render([proxy({ id: 'off', type: 'wireguard', enabled: false })])
    const options = proxySelect(page)!.findAll('option').map((o) => o.attributes('value'))
    expect(options).toEqual([''])
    expect(page.text()).toContain('No proxy can carry this monitor type yet')
  })

  it('keeps the selector reachable when the kind loses proxy support', async () => {
    // The panel stays visible while a pin exists, precisely so the user can clear it.
    // Hiding it left a dead end: the save was blocked by the now-incapable pin, but the
    // only control that could remove the pin was gone.
    const page = await render([proxy({ id: 'wg', type: 'wireguard' })])
    await proxySelect(page)!.setValue('wg')
    await kindSelect(page).setValue('gateway')
    await flushPromises()

    const sel = proxySelect(page)
    expect(sel).not.toBeNull()
    expect(page.text()).toContain('cannot carry this monitor type')

    // Unpinning through that control makes the monitor savable again.
    apiMock.setTargets.mockResolvedValue({ ok: true, warnings: [] })
    await sel!.setValue('')
    await page.get('button.btn-primary').trigger('click')
    await flushPromises()
    const saved = apiMock.setTargets.mock.calls[0][1] as ProbeTarget[]
    expect(saved[0].proxy_id).toBe('')
  })

  it('never leaves a pin on a kind that cannot be pinned at all', async () => {
    // With no pin to preserve, switching to a proxy-less kind hides the panel — there is
    // nothing to clear, so offering the control would only be noise.
    apiMock.setTargets.mockResolvedValue({ ok: true, warnings: [] })
    const page = await render([proxy({ id: 'wg', type: 'wireguard' })])
    await kindSelect(page).setValue('gateway')
    await flushPromises()
    expect(proxySelect(page)).toBeNull()

    await page.get('button.btn-primary').trigger('click')
    await flushPromises()
    const saved = apiMock.setTargets.mock.calls[0][1] as ProbeTarget[]
    expect(saved[0].proxy_id).toBe('')
  })

  it('warns about a disabled pin without blocking the save', async () => {
    // Disabling an in-use proxy is supported: the server keeps the pin and the agent
    // fails the monitor closed. Blocking the save made unrelated edits impossible.
    apiMock.setTargets.mockResolvedValue({ ok: true, warnings: [] })
    state.route = { params: { id: 't1' }, path: '/monitoring/t1/edit', query: {} }
    const page = await render(
      [proxy({ id: 'off', name: 'Paused', type: 'wireguard', enabled: false })],
      [{
        id: 't1', group_id: 'group-default', kind: 'icmp', name: 'Ping',
        target: '1.1.1.1', params: {}, enabled: true, proxy_id: 'off',
      }],
    )
    expect(page.text()).toContain('is disabled')

    await page.get('button.btn-primary').trigger('click')
    await flushPromises()
    expect(apiMock.setTargets).toHaveBeenCalledTimes(1)
    const saved = apiMock.setTargets.mock.calls[0][1] as ProbeTarget[]
    // The pin is preserved: re-enabling the proxy must restore the monitor as-is.
    expect(saved.find((t) => t.id === 't1')!.proxy_id).toBe('off')
  })

  it('explains a selection the new kind cannot use, and blocks the save', async () => {
    apiMock.setTargets.mockResolvedValue({ ok: true, warnings: [] })
    const page = await render([proxy({ id: 'socks', name: 'Office', type: 'socks5' })])
    await kindSelect(page).setValue('http')
    await flushPromises()
    await proxySelect(page)!.setValue('socks')

    // ICMP cannot traverse a CONNECT tunnel. The selection stays visible and is
    // explained rather than silently vanishing.
    await kindSelect(page).setValue('icmp')
    await flushPromises()
    expect(page.text()).toContain('cannot carry this monitor type')

    await page.get('button.btn-primary').trigger('click')
    await flushPromises()
    expect(apiMock.setTargets).not.toHaveBeenCalled()
  })

  it('explains a selection invalidated by a protocol-param edit', async () => {
    // An HTTP proxy is the one this case can use: CONNECT carries a TCP byte stream
    // only, so the resolver protocol decides whether it can be used at all. SOCKS5
    // relays UDP (UDP ASSOCIATE), so no resolver setting invalidates it.
    const page = await render([proxy({ id: 'web', name: 'Web proxy', type: 'http' })])
    await kindSelect(page).setValue('dns')
    await flushPromises()
    // A proxied DNS monitor must name a resolver endpoint: the system resolver has no
    // address for a proxy to relay to, so without one nothing is offered at all.
    const resolverServer = page.findAll('label.field').find(
      (l) => l.find('span').text() === 'Resolver server',
    )!
    await resolverServer.find('input').setValue('1.1.1.1')
    // DoT is stream-framed, so a CONNECT relay can carry it.
    const resolverProto = page.findAll('label.field').find(
      (l) => l.find('span').text() === 'Resolver protocol',
    )!
    await resolverProto.find('select').setValue('dot')
    await flushPromises()
    await proxySelect(page)!.setValue('web')
    expect(page.text()).not.toContain('cannot carry this monitor type')

    // Plain UDP is datagram DNS, which CONNECT cannot tunnel.
    await resolverProto.find('select').setValue('udp')
    await flushPromises()
    expect(page.text()).toContain('cannot carry this monitor type')
  })

  it('saves the chosen proxy on the target', async () => {
    apiMock.setTargets.mockResolvedValue({ ok: true, warnings: [] })
    const page = await render([proxy({ id: 'wg', name: 'Tunnel', type: 'wireguard' })])
    await proxySelect(page)!.setValue('wg')
    const targetField = page.findAll('label.field').find((l) => l.find('span').text() === 'Target')!
    await targetField.find('input').setValue('1.1.1.1')

    await page.get('button.btn-primary').trigger('click')
    await flushPromises()
    const saved = apiMock.setTargets.mock.calls[0][1] as ProbeTarget[]
    expect(saved[0].proxy_id).toBe('wg')
  })

  it('states the fail-closed behaviour once a proxy is pinned', async () => {
    // The operator must know a proxy outage stops the monitor rather than silently
    // measuring the direct path.
    const page = await render([proxy({ id: 'wg', type: 'wireguard' })])
    expect(page.text()).not.toContain('stops probing rather than falling back')
    await proxySelect(page)!.setValue('wg')
    expect(page.text()).toContain('stops probing rather than falling back')
  })

  it('loads an existing monitor with its pin selected', async () => {
    state.route = { params: { id: 't1' }, path: '/monitoring/t1/edit', query: {} }
    const page = await render(
      [proxy({ id: 'wg', name: 'Tunnel', type: 'wireguard' })],
      [{
        id: 't1', group_id: 'group-default', kind: 'icmp', name: 'Ping',
        target: '1.1.1.1', params: {}, enabled: true, proxy_id: 'wg',
      }],
    )
    expect((proxySelect(page)!.element as HTMLSelectElement).value).toBe('wg')
  })
})
