import { describe, expect, it } from 'vitest'

import { parseRemoteAddr, quickAddQuery } from './netaddr'

describe('parseRemoteAddr', () => {
  it.each([undefined, null, '', '   '])('rejects an empty remote address: %s', (value) => {
    expect(parseRemoteAddr(value)).toBeNull()
  })

  it('parses IPv4 and bracketed IPv6 endpoints', () => {
    expect(parseRemoteAddr('1.2.3.4:443')).toEqual({ ip: '1.2.3.4', port: 443 })
    expect(parseRemoteAddr('[2001:db8::1]:65535')).toEqual({ ip: '2001:db8::1', port: 65535 })
  })

  it('preserves a defensive bare IPv6 literal without fabricating a port', () => {
    expect(parseRemoteAddr('fe80::1')).toEqual({ ip: 'fe80::1', port: null })
  })

  it('rejects invalid TCP port boundaries', () => {
    expect(parseRemoteAddr('1.2.3.4:0')).toEqual({ ip: '1.2.3.4', port: null })
    expect(parseRemoteAddr('1.2.3.4:65536')).toEqual({ ip: '1.2.3.4', port: null })
    expect(parseRemoteAddr('1.2.3.4:not-a-port')).toEqual({ ip: '1.2.3.4', port: null })
  })
})

describe('quickAddQuery', () => {
  it('creates TCP queries with the remote port for IPv4 and IPv6', () => {
    expect(quickAddQuery('tcp', '1.2.3.4:443')).toEqual({
      kind: 'tcp', target: '1.2.3.4', port: '443',
    })
    expect(quickAddQuery('tcp6', '[2001:db8::1]:8443')).toEqual({
      kind: 'tcp', target: '2001:db8::1', port: '8443',
    })
  })

  it('creates ICMP queries without a port for every non-TCP protocol', () => {
    expect(quickAddQuery('udp', '8.8.8.8:53')).toEqual({ kind: 'icmp', target: '8.8.8.8' })
    expect(quickAddQuery('udp6', '[2001:4860:4860::8888]:53')).toEqual({
      kind: 'icmp', target: '2001:4860:4860::8888',
    })
  })

  it('offers no action without a usable remote IP or valid TCP port', () => {
    expect(quickAddQuery('tcp', undefined)).toBeNull()
    expect(quickAddQuery('tcp', '1.2.3.4:0')).toBeNull()
    expect(quickAddQuery('udp', '0.0.0.0:53')).toBeNull()
    expect(quickAddQuery('tcp6', '[::]:443')).toBeNull()
  })
})
