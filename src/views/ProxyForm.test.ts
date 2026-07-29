import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import en from '../locales/en'
import type { Proxy, ProxyInput } from '../api'

const state = vi.hoisted(() => ({
  route: { params: {} as Record<string, string>, path: '/proxies/new', query: {} as Record<string, string> },
  push: vi.fn(),
  replace: vi.fn(),
}))
const apiMock = vi.hoisted(() => ({
  listTargets: vi.fn(), proxies: vi.fn(), createProxy: vi.fn(), updateProxy: vi.fn(),
}))

vi.mock('../api', async () => {
  // REDACTED_SECRET is a real constant the component compares against, so the module is
  // partially mocked rather than replaced wholesale.
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, api: apiMock }
})
vi.mock('vue-router', () => ({
  useRoute: () => state.route,
  useRouter: () => ({ replace: state.replace, push: state.push }),
  RouterLink: { template: '<a><slot /></a>' },
}))

const REDACTED = '••••••'

const storedRelay = (over: Partial<Proxy> = {}): Proxy => ({
  id: 'p1', site_id: 'site_default', name: 'Office', type: 'socks5', enabled: true, used_by: 0,
  host: 'proxy.example.com', port: 1080, username: 'u',
  // A read returns the placeholder when a secret is set — never the secret itself.
  password: REDACTED, dns_mode: 'local',
  ...over,
})

async function render(proxies: Proxy[] = []) {
  apiMock.listTargets.mockResolvedValue([])
  apiMock.proxies.mockResolvedValue(proxies)
  apiMock.createProxy.mockResolvedValue({ id: 'new' })
  apiMock.updateProxy.mockResolvedValue({})
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
  const ProxyForm = (await import('./ProxyForm.vue')).default
  const page = mount(ProxyForm, {
    global: { plugins: [i18n], stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  })
  await flushPromises()
  return page
}

function field(page: Awaited<ReturnType<typeof render>>, label: string) {
  return page.findAll('label.field').find((l) => l.find('span').text() === label)
}

function typeSelect(page: Awaited<ReturnType<typeof render>>) {
  return field(page, 'Type')!.find('select')
}

async function save(page: Awaited<ReturnType<typeof render>>) {
  await page.get('button.btn-primary').trigger('click')
  await flushPromises()
}

beforeEach(() => {
  vi.clearAllMocks()
  state.route = { params: {}, path: '/proxies/new', query: {} }
})

describe('ProxyForm credentials are write-only', () => {
  it('keeps a stored password when the form is saved untouched', async () => {
    state.route = { params: { id: 'p1' }, path: '/proxies/p1/edit', query: {} }
    const page = await render([storedRelay()])
    await save(page)
    const body = apiMock.updateProxy.mock.calls[0][1] as ProxyInput
    // Sending the placeholder back is what tells the server "keep the stored value".
    expect(body.password).toBe(REDACTED)
  })

  it('survives a round-trip type toggle without deleting the password', async () => {
    // The regression: switching away and back used to clear the placeholder, so the
    // save submitted password:'' — which the API reads as "delete the credential",
    // silently breaking every monitor pinned to the proxy.
    state.route = { params: { id: 'p1' }, path: '/proxies/p1/edit', query: {} }
    const page = await render([storedRelay()])

    await typeSelect(page).setValue('wireguard')
    await flushPromises()
    await typeSelect(page).setValue('socks5')
    await flushPromises()

    await save(page)
    const body = apiMock.updateProxy.mock.calls[0][1] as ProxyInput
    expect(body.password).toBe(REDACTED)
  })

  it('still lets the user clear a credential deliberately', async () => {
    // Empty has to keep meaning "remove it", or a password could never be unset.
    state.route = { params: { id: 'p1' }, path: '/proxies/p1/edit', query: {} }
    const page = await render([storedRelay()])
    await field(page, 'Password')!.find('input').setValue('')
    await save(page)
    const body = apiMock.updateProxy.mock.calls[0][1] as ProxyInput
    expect(body.password).toBe('')
  })

  it('sends a rotated credential verbatim', async () => {
    state.route = { params: { id: 'p1' }, path: '/proxies/p1/edit', query: {} }
    const page = await render([storedRelay()])
    await field(page, 'Password')!.find('input').setValue('rotated')
    await save(page)
    const body = apiMock.updateProxy.mock.calls[0][1] as ProxyInput
    expect(body.password).toBe('rotated')
  })

  it('does not leak the inactive shape when saving as a tunnel', async () => {
    // Saving as WireGuard must not carry the relay placeholder along; the server clears
    // those columns anyway, but the payload should not claim otherwise.
    state.route = { params: { id: 'p1' }, path: '/proxies/p1/edit', query: {} }
    const page = await render([storedRelay()])
    await typeSelect(page).setValue('wireguard')
    await flushPromises()
    for (const [label, value] of [
      ['Local private key (base64)', 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8='],
      ['Peer public key (base64)', 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8='],
      ['Peer endpoint (host:port)', 'wg.example.com:51820'],
      ['Allowed IPs routed into the tunnel (CIDRs, comma-separated)', '10.7.0.0/24'],
      ['Local in-tunnel addresses (comma-separated)', '10.7.0.2/32'],
    ] as const) {
      await field(page, label)!.find('input').setValue(value)
    }
    await save(page)
    const body = apiMock.updateProxy.mock.calls[0][1] as ProxyInput
    expect(body.password).toBe('')
    expect(body.host).toBe('')
  })
})

describe('ProxyForm host validation', () => {
  it('accepts a bare IPv6 relay host', async () => {
    // The colons are address separators, not a misplaced port. The server accepts an
    // unbracketed IPv6 literal and joins it with the port field, so the form must too.
    const page = await render()
    await field(page, 'Name')!.find('input').setValue('v6')
    await field(page, 'Proxy host')!.find('input').setValue('2001:db8::1')
    await field(page, 'Port')!.find('input').setValue('1080')
    await save(page)
    expect(apiMock.createProxy).toHaveBeenCalledTimes(1)
    const body = apiMock.createProxy.mock.calls[0][1] as ProxyInput
    expect(body.host).toBe('2001:db8::1')
  })

  it('still rejects a host:port in the host field', async () => {
    const page = await render()
    await field(page, 'Name')!.find('input').setValue('bad')
    await field(page, 'Proxy host')!.find('input').setValue('proxy.example.com:1080')
    await field(page, 'Port')!.find('input').setValue('1080')
    await save(page)
    expect(apiMock.createProxy).not.toHaveBeenCalled()
    expect(page.text()).toContain('Do not put the port in the host field')
  })

  it('still rejects a URL in the host field', async () => {
    const page = await render()
    await field(page, 'Name')!.find('input').setValue('bad')
    await field(page, 'Proxy host')!.find('input').setValue('socks5://proxy.example.com')
    await field(page, 'Port')!.find('input').setValue('1080')
    await save(page)
    expect(apiMock.createProxy).not.toHaveBeenCalled()
    expect(page.text()).toContain('drop the socks5:// or http:// prefix')
  })
})
