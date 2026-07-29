import { describe, expect, it } from 'vitest'
import type { Proxy, ProxyType } from '../api'
import {
  anyProxyCapable,
  proxyCapable,
  proxyDisabledWarning,
  proxyUnusableReason,
  usableProxies,
} from './proxyCapability'

// These cases mirror protocol/config/proxy_test.go's TestProxyCapable one-for-one.
// Drift between the two is exactly the bug this file exists to catch: the console
// would offer a combination the server rejects and the agent refuses to run.
describe('proxyCapable', () => {
  const cases: Array<[string, string, Record<string, unknown>, ProxyType, boolean]> = [
    ['http via socks5', 'http', {}, 'socks5', true],
    ['http via http', 'http', {}, 'http', true],
    ['http via wireguard', 'http', {}, 'wireguard', true],
    ['tcp via socks5', 'tcp', {}, 'socks5', true],
    ['tcp via wireguard', 'tcp', {}, 'wireguard', true],

    // DNS. SOCKS5 relays UDP via UDP ASSOCIATE, so every resolver protocol works.
    // HTTP has only CONNECT, so it is limited to the stream-framed ones. Every case
    // must also name a resolver endpoint — see proxiedDNSHasEndpoint.
    ['dns udp via socks5', 'dns', { resolver_protocol: 'udp', resolver_server: '1.1.1.1' }, 'socks5', true],
    ['dns tcp via socks5', 'dns', { resolver_protocol: 'tcp', resolver_server: '1.1.1.1' }, 'socks5', true],
    ['dns dot via socks5', 'dns', { resolver_protocol: 'dot', resolver_server: '1.1.1.1' }, 'socks5', true],
    ['dns doh via http', 'dns', { resolver_protocol: 'doh', resolver_server: 'https://d.example/dns-query' }, 'http', true],
    ['dns tcp via http', 'dns', { resolver_protocol: 'tcp', resolver_server: '1.1.1.1' }, 'http', true],
    ['dns udp via http', 'dns', { resolver_protocol: 'udp', resolver_server: '1.1.1.1' }, 'http', false],
    ['dns udp via wireguard', 'dns', { resolver_protocol: 'udp', resolver_server: '1.1.1.1' }, 'wireguard', true],
    // The value comes from a form field, so case and whitespace must not matter.
    // Asserted on HTTP, the type that actually branches on the protocol string.
    ['dns DoT uppercase via http', 'dns', { resolver_protocol: ' DoT ', resolver_server: '1.1.1.1' }, 'http', true],

    // The SYSTEM resolver has no address on the wire, so no transport can carry it.
    // Allowing it would let the query resolve off the host and report success while
    // the pinned egress was down.
    ['dns system resolver via socks5', 'dns', {}, 'socks5', false],
    ['dns system resolver via http', 'dns', {}, 'http', false],
    ['dns system resolver via wireguard', 'dns', {}, 'wireguard', false],
    ['dns udp without a resolver via socks5', 'dns', { resolver_protocol: 'udp' }, 'socks5', false],
    ['dns whitespace resolver via socks5', 'dns', { resolver_protocol: 'udp', resolver_server: '  ' }, 'socks5', false],

    // NAT/STUN. Same split ('' defaults to udp).
    ['nat default via socks5', 'nat', {}, 'socks5', true],
    ['nat udp via socks5', 'nat', { nat_transport: 'udp' }, 'socks5', true],
    ['nat dtls via socks5', 'nat', { nat_transport: 'dtls' }, 'socks5', true],
    ['nat tcp via socks5', 'nat', { nat_transport: 'tcp' }, 'socks5', true],
    ['nat default via http', 'nat', {}, 'http', false],
    ['nat udp via http', 'nat', { nat_transport: 'udp' }, 'http', false],
    ['nat dtls via http', 'nat', { nat_transport: 'dtls' }, 'http', false],
    ['nat tcp via http', 'nat', { nat_transport: 'tcp' }, 'http', true],
    ['nat tls via http', 'nat', { nat_transport: 'tls' }, 'http', true],
    ['nat udp via wireguard', 'nat', { nat_transport: 'udp' }, 'wireguard', true],

    // ICMP is the one kind NEITHER relay can forward — no command exists for it — so
    // it stays tunnel-only even though SOCKS5 does carry UDP.
    ['icmp via socks5', 'icmp', {}, 'socks5', false],
    ['icmp via http', 'icmp', {}, 'http', false],
    ['icmp via wireguard', 'icmp', {}, 'wireguard', true],

    // Local / server-side anchors are never proxied.
    ['gateway via socks5', 'gateway', {}, 'socks5', false],
    ['gateway via wireguard', 'gateway', {}, 'wireguard', false],
    ['host via wireguard', 'host', {}, 'wireguard', false],

    // Unknown inputs are refused, never assumed capable.
    ['unknown proxy type', 'http', {}, 'shadowsocks' as ProxyType, false],
    ['unknown kind', 'smtp', {}, 'wireguard', false],
  ]

  for (const [name, kind, params, type, want] of cases) {
    it(name, () => {
      expect(proxyCapable(kind, params, type)).toBe(want)
    })
  }

  it('treats undefined params as empty', () => {
    expect(proxyCapable('http', undefined, 'socks5')).toBe(true)
    // Absent params means no resolver endpoint, which no transport can carry.
    expect(proxyCapable('dns', undefined, 'http')).toBe(false)
    expect(proxyCapable('dns', undefined, 'socks5')).toBe(false)
  })
})

describe('anyProxyCapable', () => {
  it('shows the picker for kinds at least one transport can carry', () => {
    expect(anyProxyCapable('http', {})).toBe(true)
    expect(anyProxyCapable('tcp', {})).toBe(true)
    // WireGuard-only kinds still qualify: the picker appears with only the tunnel
    // offered.
    expect(anyProxyCapable('icmp', {})).toBe(true)
    expect(anyProxyCapable('dns', { resolver_protocol: 'udp', resolver_server: '1.1.1.1' })).toBe(true)
    expect(anyProxyCapable('nat', {})).toBe(true)
  })
  it('hides the picker where no transport can carry the kind', () => {
    expect(anyProxyCapable('gateway', {})).toBe(false)
    expect(anyProxyCapable('host', {})).toBe(false)
    // A DNS monitor on the system resolver has nothing to relay, so the picker is
    // hidden rather than offering options that would all be refused.
    expect(anyProxyCapable('dns', {})).toBe(false)
  })
})

const proxy = (over: Partial<Proxy>): Proxy => ({
  id: 'p', site_id: 'site_default', name: 'p', type: 'socks5', enabled: true, used_by: 0, ...over,
})

describe('usableProxies', () => {
  const all = [
    proxy({ id: 'socks', type: 'socks5' }),
    proxy({ id: 'http', type: 'http' }),
    proxy({ id: 'wg', type: 'wireguard' }),
    proxy({ id: 'off', type: 'wireguard', enabled: false }),
  ]

  it('offers every capable transport for an http monitor', () => {
    expect(usableProxies(all, 'http', {}).map((p) => p.id)).toEqual(['socks', 'http', 'wg'])
  })
  it('offers only the tunnel for an icmp monitor', () => {
    expect(usableProxies(all, 'icmp', {}).map((p) => p.id)).toEqual(['wg'])
  })
  it('offers nothing for a gateway monitor', () => {
    expect(usableProxies(all, 'gateway', {})).toEqual([])
  })
  it('never offers a disabled proxy', () => {
    // A disabled proxy is dropped from the config push, so pinning one would fail the
    // monitor closed — it must not be selectable.
    expect(usableProxies(all, 'http', {}).some((p) => p.id === 'off')).toBe(false)
  })
})

describe('proxyDisabledWarning', () => {
  it('warns about a disabled selection', () => {
    expect(proxyDisabledWarning(proxy({ enabled: false }))).toBe('pform.selectedDisabled')
  })
  it('is silent for an enabled selection and for none', () => {
    expect(proxyDisabledWarning(proxy({ enabled: true }))).toBe('')
    expect(proxyDisabledWarning(undefined)).toBe('')
  })
})

describe('proxyUnusableReason', () => {
  it('is empty when nothing is selected', () => {
    expect(proxyUnusableReason(undefined, 'http', {})).toBe('')
  })
  it('is empty for a valid selection', () => {
    expect(proxyUnusableReason(proxy({ type: 'socks5' }), 'http', {})).toBe('')
  })
  it('does NOT treat a disabled selection as unusable', () => {
    // A disabled pin is valid: the server keeps it and the agent fails the monitor
    // closed by design. Reporting it here blocked every unrelated edit (a rename, a
    // group move) until the proxy came back — proxyDisabledWarning is the warning path.
    expect(proxyUnusableReason(proxy({ enabled: false }), 'http', {})).toBe('')
  })
  it('explains a selection the kind cannot use', () => {
    // The realistic path: an HTTP monitor pinned to SOCKS5, then switched to ICMP.
    expect(proxyUnusableReason(proxy({ type: 'socks5' }), 'icmp', {})).toBe('pform.selectedIncapable')
  })
  it('explains a selection invalidated by a params edit', () => {
    // A DoT monitor through an HTTP proxy is fine; switching the resolver to plain UDP
    // is not, because CONNECT cannot carry datagrams. SOCKS5 is unaffected — it relays
    // UDP — so HTTP is the type this case has to use.
    const p = proxy({ type: 'http' })
    expect(proxyUnusableReason(p, 'dns', { resolver_protocol: 'dot', resolver_server: '1.1.1.1' })).toBe('')
    expect(proxyUnusableReason(p, 'dns', { resolver_protocol: 'udp', resolver_server: '1.1.1.1' })).toBe('pform.selectedIncapable')
  })
})
