import { describe, expect, it } from 'vitest'

import en from '../locales/en'
import zh from '../locales/zh'
import { bareHostError, httpURLError, paramsRangeError, retargetForKind, targetError } from './targetValidation'

// Every key this module can return must exist in BOTH locales, or a rejected
// target renders as a raw key.
describe('targetValidation i18n coverage', () => {
  const keys = [
    'errHostRequired', 'errHostIsURL', 'errHostSpace', 'errHostPath', 'errHostCredentials',
    'errHostPort', 'errHostPortSyntax', 'errHostPortRange', 'errHostTooLong', 'errHostNonAscii',
    'errHostEmptyLabel', 'errHostLabelTooLong', 'errHostHyphen', 'errHostChar',
    'errURLScheme', 'errURLInvalid', 'errURLNoHost', 'errParamRange',
  ] as const
  it('has zh and en messages for every error key', () => {
    for (const k of keys) {
      expect(en.mform[k as keyof typeof en.mform], `en.mform.${k}`).toBeTruthy()
      expect(zh.mform[k as keyof typeof zh.mform], `zh.mform.${k}`).toBeTruthy()
    }
  })
})

describe('bareHostError', () => {
  it('accepts real hostnames and IP literals', () => {
    for (const ok of [
      'www.yahoo.co.jp', 'example.com.', 'localhost', 'my_nas.local', '_dmarc.example.com',
      '1.1.1.1', '2001:db8::1', 'my-host.example.com', '123.example.com',
    ]) {
      expect(bareHostError(ok), ok).toBe('')
    }
  })

  it('rejects the shapes that can only fail at probe time', () => {
    // The reported bug: an http URL carried into a host field by a kind switch.
    expect(bareHostError('https://www.yahoo.co.jp')).toBe('mform.errHostIsURL')
    expect(bareHostError('http://example.com')).toBe('mform.errHostIsURL')
    expect(bareHostError('example.com/health')).toBe('mform.errHostPath')
    expect(bareHostError('example.com?a=1')).toBe('mform.errHostPath')
    expect(bareHostError('user@example.com')).toBe('mform.errHostCredentials')
    expect(bareHostError('exa mple.com')).toBe('mform.errHostSpace')
    expect(bareHostError('example..com')).toBe('mform.errHostEmptyLabel')
    expect(bareHostError('-bad.example.com')).toBe('mform.errHostHyphen')
    expect(bareHostError('*.example.com')).toBe('mform.errHostChar')
    expect(bareHostError('中文.com')).toBe('mform.errHostNonAscii')
    expect(bareHostError('a'.repeat(64) + '.com')).toBe('mform.errHostLabelTooLong')
    expect(bareHostError('  ')).toBe('mform.errHostRequired')
  })

  it('routes the port to its own field unless the kind allows host:port', () => {
    expect(bareHostError('example.com:443')).toBe('mform.errHostPort')
    expect(bareHostError('stun.example.com:3478', { allowPort: true })).toBe('')
    expect(bareHostError('[2001:db8::1]:3478', { allowPort: true })).toBe('')
    expect(bareHostError('stun.example.com:70000', { allowPort: true })).toBe('mform.errHostPortRange')
    expect(bareHostError('host:3478:extra', { allowPort: true })).toBe('mform.errHostPortSyntax')
    expect(bareHostError('https://stun.example.com', { allowPort: true })).toBe('mform.errHostIsURL')
  })
})

describe('httpURLError', () => {
  it('accepts absolute http(s) URLs, including IPv6 literals', () => {
    for (const ok of ['https://example.com', 'http://192.168.1.5:9000/', 'https://[::1]/', 'https://example.com/a?b=c']) {
      expect(httpURLError(ok), ok).toBe('')
    }
  })
  it('rejects a non-http scheme and an out-of-range port', () => {
    expect(httpURLError('ftp://example.com')).toBe('mform.errURLScheme')
    expect(httpURLError('https://example.com:70000/')).toBe('mform.errHostPortRange')
  })
})

// The inputs' min/max never fire (the form saves from a button click, not a form
// submit), so these checks are the only thing keeping an unusable value out.
describe('paramsRangeError', () => {
  it('accepts defaults, blanks and in-range values', () => {
    expect(paramsRangeError('icmp', undefined)).toBeNull()
    expect(paramsRangeError('icmp', {})).toBeNull()
    expect(paramsRangeError('icmp', { packet_count: '', packet_size: null })).toBeNull()
    expect(paramsRangeError('icmp', { packet_count: 5, packet_size: 56, global_timeout_ms: 10000 })).toBeNull()
    expect(paramsRangeError('http', { max_redirects: -1, max_response_bytes: 1024 })).toBeNull()
		expect(paramsRangeError('http', { flow_fanout: 32 })).toBeNull()
    expect(paramsRangeError('tcp', { port: 443 })).toBeNull()
    expect(paramsRangeError('tcp', { flow_fanout: 0 })).toBeNull() // off
    expect(paramsRangeError('tcp', { port: 443, flow_fanout: 32 })).toBeNull() // max
    // size_sweep is a boolean; PARAM_RANGES only checks numeric keys it knows, so
    // the flag must never trip the range check.
    expect(paramsRangeError('icmp', { size_sweep: true })).toBeNull()
    expect(paramsRangeError('icmp', { size_sweep: false })).toBeNull()
  })

  it('rejects the values the server would reject', () => {
    expect(paramsRangeError('icmp', { packet_count: 101 })?.labelKey).toBe('mform.packetCount')
    expect(paramsRangeError('icmp', { packet_size: 70000 })?.labelKey).toBe('mform.packetSize')
    expect(paramsRangeError('http', { max_redirects: 21 })?.labelKey).toBe('mform.maxRedirects')
    expect(paramsRangeError('http', { max_response_bytes: 1 << 30 })?.labelKey).toBe('mform.maxResponseBytes')
		expect(paramsRangeError('http', { flow_fanout: 33 })?.labelKey).toBe('mform.httpFlowFanout')
    expect(paramsRangeError('dns', { resolver_port: 70000 })?.labelKey).toBe('mform.resolverPort')
    expect(paramsRangeError('tcp', { port: 0 })?.labelKey).toBe('mform.port')
    expect(paramsRangeError('tcp', { flow_fanout: 33 })?.labelKey).toBe('mform.tcpFlowFanout')
    expect(paramsRangeError('tcp', { flow_fanout: -1 })?.labelKey).toBe('mform.tcpFlowFanout')
    const frac = paramsRangeError('tcp', { flow_fanout: 2.5 })
    expect(frac?.labelKey).toBe('mform.tcpFlowFanout') // integer count
    expect(frac?.integer).toBe(true) // the renderer says "whole number", not "between 0 and 32"
    // 32.5 is both fractional AND out of range: the range error must win (it is
    // the more actionable one — fixing the range reveals the integer constraint).
    const oobFrac = paramsRangeError('tcp', { flow_fanout: 32.5 })
    expect(oobFrac?.labelKey).toBe('mform.tcpFlowFanout')
    expect(oobFrac?.integer).toBeFalsy()
    expect(paramsRangeError('tcp', { flow_fanout: 8 })?.integer).toBeFalsy()
    expect(paramsRangeError('icmp', { interval_seconds: 90000 })?.labelKey).toBe('mform.interval')
  })

  it('gateway shares the ICMP cycle params', () => {
    expect(paramsRangeError('gateway', { packet_count: 101 })?.labelKey).toBe('mform.packetCount')
  })

  it('names timeout_ms by the label the kind actually shows', () => {
    expect(paramsRangeError('icmp', { timeout_ms: 300001 })?.labelKey).toBe('mform.perPingTimeout')
    expect(paramsRangeError('gateway', { timeout_ms: 300001 })?.labelKey).toBe('mform.perPingTimeout')
    expect(paramsRangeError('http', { timeout_ms: 300001 })?.labelKey).toBe('mform.timeout')
  })

  it('ignores params belonging to another kind, matching the server', () => {
    expect(paramsRangeError('http', { packet_count: 100000 })).toBeNull()
    expect(paramsRangeError('dns', { max_redirects: 999 })).toBeNull()
    expect(paramsRangeError('icmp', { flow_fanout: 999 })).toBeNull() // tcp-only param
  })
})

describe('targetError per kind', () => {
  it('applies the URL rule to http and the host rule to the dialing kinds', () => {
    expect(targetError('http', 'https://www.yahoo.co.jp')).toBe('')
    for (const kind of ['dns', 'icmp', 'tcp']) {
      expect(targetError(kind, 'https://www.yahoo.co.jp'), kind).toBe('mform.errHostIsURL')
      expect(targetError(kind, 'www.yahoo.co.jp'), kind).toBe('')
    }
    expect(targetError('nat', 'stun.example.com:3478')).toBe('')
  })

  it('never judges the anchor kinds, whose target is not an address', () => {
    expect(targetError('gateway', 'gateway')).toBe('')
    for (const subject of ['host', '*', 'C:', '/mnt/data']) {
      expect(targetError('host', subject), subject).toBe('')
    }
  })
})

describe('retargetForKind', () => {
  it('converts a URL to its hostname when leaving http', () => {
    expect(retargetForKind('https://www.yahoo.co.jp', 'http', 'dns')).toBe('www.yahoo.co.jp')
    expect(retargetForKind('https://example.com:8443/health', 'http', 'tcp')).toBe('example.com')
  })

  // URL.hostname keeps the brackets on an IPv6 literal, which every bare-host
  // field rejects — a valid http monitor would become unsavable on kind change.
  it('unwraps an IPv6 literal so the converted target is valid', () => {
    for (const kind of ['dns', 'icmp', 'tcp']) {
      const got = retargetForKind('https://[2001:db8::1]/', 'http', kind)
      expect(got, kind).toBe('2001:db8::1')
      expect(targetError(kind, got), kind).toBe('')
    }
  })

  // NAT is the one host-shaped kind whose endpoint IS "host[:port]" — it has no
  // separate port input, so dropping the port would silently repoint the monitor
  // at the default STUN port.
  it('keeps the port when converting to NAT, and drops it for kinds with a port field', () => {
    expect(retargetForKind('https://stun.example.com:5349/', 'http', 'nat')).toBe('stun.example.com:5349')
    expect(retargetForKind('https://[2001:db8::1]:5349/', 'http', 'nat')).toBe('[2001:db8::1]:5349')
    expect(retargetForKind('https://stun.example.com/', 'http', 'nat')).toBe('stun.example.com')
    expect(retargetForKind('https://example.com:8443/', 'http', 'tcp')).toBe('example.com')
  })

  it('produces a target the validator accepts for every conversion', () => {
    for (const kind of ['dns', 'icmp', 'tcp', 'nat']) {
      expect(targetError(kind, retargetForKind('https://stun.example.com:5349/x', 'http', kind)), kind).toBe('')
    }
  })
  it('leaves the value alone when the kind is unchanged or already host-shaped', () => {
    expect(retargetForKind('https://a.test', 'http', 'http')).toBe('https://a.test')
    expect(retargetForKind('www.yahoo.co.jp', 'dns', 'http')).toBe('www.yahoo.co.jp')
    expect(retargetForKind('1.1.1.1', 'icmp', 'dns')).toBe('1.1.1.1')
    expect(retargetForKind('', 'http', 'dns')).toBe('')
  })
})
