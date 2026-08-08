// Client-side mirror of server-core's monitoring-target address rules
// (server-core/api/probevalidate.go). The server stays authoritative — this
// exists so a wrong shape is reported under the field as it is typed, instead of
// after a save round trip, and so switching a monitor's kind can repair the
// carried-over target instead of silently persisting one the probe can only fail.
//
// Errors are returned as i18n keys (mform.err*) so the caller translates them.

// Only a LEADING scheme means "this is a URL": a "://" further along belongs to
// the path or query ("example.com/login?next=https://idp").
export const LEADING_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i

const MAX_HOST_LEN = 253
const MAX_LABEL_LEN = 63

export interface HostRule {
  /** Accept a "host:port" suffix (STUN endpoints). Off where the kind carries the port in its own field. */
  allowPort?: boolean
}

function isIPv4(s: string): boolean {
  const parts = s.split('.')
  if (parts.length !== 4) return false
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
}

// A permissive IPv6 literal test: hex groups and "::". Exact IPv6 grammar is the
// server's job — here it only has to stop a colon-dense address from being read
// as "host:port".
function isIPv6(s: string): boolean {
  return s.includes(':') && /^[0-9a-f:.]+$/i.test(s) && !s.includes(':::')
}

/**
 * Validate a bare-host monitoring target (dns / icmp / tcp / nat, resolver_server,
 * stun_server2). Returns an i18n key, or '' when the value is acceptable.
 */
export function bareHostError(raw: string, rule: HostRule = {}): string {
  const s = raw.trim()
  if (!s) return 'mform.errHostRequired'
  if (LEADING_SCHEME.test(s)) return 'mform.errHostIsURL'
  if (/[\s]/.test(s)) return 'mform.errHostSpace'
  if (/[/?#]/.test(s)) return 'mform.errHostPath'
  if (s.includes('@')) return 'mform.errHostCredentials'

  if (isIPv4(s) || isIPv6(s)) return ''

  let host = s
  if (s.includes(':')) {
    if (!rule.allowPort) return 'mform.errHostPort'
    const m = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(s)
    if (!m) return 'mform.errHostPortSyntax'
    const port = Number(m[2])
    if (!Number.isInteger(port) || port < 1 || port > 65535) return 'mform.errHostPortRange'
    host = m[1]
    if (host.startsWith('[') && host.endsWith(']')) return isIPv6(host.slice(1, -1)) ? '' : 'mform.errHostPortSyntax'
    if (isIPv4(host)) return ''
  }
  return hostnameError(host)
}

/** DNS name syntax; '' when valid. Mirrors validateHostname. */
export function hostnameError(host: string): string {
  const name = host.endsWith('.') ? host.slice(0, -1) : host
  if (!name) return 'mform.errHostRequired'
  if (name.length > MAX_HOST_LEN) return 'mform.errHostTooLong'
  // Go's resolver does no IDNA, so a unicode name can only fail — punycode works.
  if (/[^\x00-\x7f]/.test(name)) return 'mform.errHostNonAscii'
  for (const label of name.split('.')) {
    if (!label) return 'mform.errHostEmptyLabel'
    if (label.length > MAX_LABEL_LEN) return 'mform.errHostLabelTooLong'
    if (label.startsWith('-') || label.endsWith('-')) return 'mform.errHostHyphen'
    // Underscore is tolerated: "_dmarc.example.com" is a real query name and
    // Windows LAN names carry them.
    if (!/^[a-z0-9_-]+$/i.test(label)) return 'mform.errHostChar'
  }
  return ''
}

/** Validate an http(s) monitor URL after normalization; '' when valid. */
export function httpURLError(raw: string): string {
  const s = raw.trim()
  if (!s) return 'mform.errHostRequired'
  if (!/^https?:\/\//i.test(s)) return 'mform.errURLScheme' // a non-http scheme; the caller prepends https:// otherwise
  // Read the port off the authority BEFORE new URL(): the constructor throws a
  // generic "Invalid URL" on an out-of-range port, which would hide the actual
  // mistake. An IPv6 authority ends in "]", so it never matches.
  const authority = s.replace(/^https?:\/\//i, '').split(/[/?#]/)[0]
  const portMatch = /:(\d*)$/.exec(authority)
  if (portMatch) {
    const port = Number(portMatch[1])
    if (!portMatch[1] || !Number.isInteger(port) || port < 1 || port > 65535) return 'mform.errHostPortRange'
  }
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return 'mform.errURLInvalid'
  }
  if (!u.hostname) return 'mform.errURLNoHost'
  return ''
}

/**
 * The per-kind entry point: which rule applies to this kind's target field.
 * gateway (server-normalized) and host (a metric-series subject like "host", "*"
 * or a mount point) are not addresses and are never checked here.
 */
export function targetError(kind: string, target: string): string {
  switch (kind) {
    case 'http':
      return httpURLError(target)
    case 'dns':
    case 'icmp':
    case 'tcp':
      return bareHostError(target)
    case 'nat':
      return bareHostError(target, { allowPort: true })
    default:
      return ''
  }
}

/**
 * A numeric param outside the range the server accepts. labelKey names the field
 * with the same i18n key its <label> uses, so the message says what to fix.
 */
export interface ParamRangeError {
  labelKey: string
  min: number
  max: number
}

// Bounds mirror server-core/api/probevalidate.go. The `min`/`max` attributes on
// the inputs are advisory only — this component saves from a button click, not a
// form submit, so the browser never runs constraint validation. These checks are
// what actually keeps an unusable value from reaching the server.
const PARAM_RANGES: Record<string, ReadonlyArray<{ key: string; labelKey: string; min: number; max: number }>> = {
  common: [
    { key: 'interval_seconds', labelKey: 'mform.interval', min: 0, max: 86400 },
    { key: 'timeout_ms', labelKey: 'mform.timeout', min: 0, max: 300000 },
  ],
  icmp: [
    { key: 'packet_count', labelKey: 'mform.packetCount', min: 0, max: 100 },
    { key: 'packet_size', labelKey: 'mform.packetSize', min: 0, max: 65500 },
    { key: 'global_timeout_ms', labelKey: 'mform.globalTimeout', min: 0, max: 300000 },
  ],
  dns: [{ key: 'resolver_port', labelKey: 'mform.resolverPort', min: 0, max: 65535 }],
  tcp: [{ key: 'port', labelKey: 'mform.port', min: 1, max: 65535 }],
  http: [
    { key: 'max_redirects', labelKey: 'mform.maxRedirects', min: -1, max: 20 },
    { key: 'max_response_bytes', labelKey: 'mform.maxResponseBytes', min: 0, max: 10485760 },
  ],
}

// timeout_ms is a common param but is not labelled the same everywhere: for the
// ping kinds it bounds one echo, not one request, so MonitorForm labels it
// `mform.perPingTimeout` there. The message has to name the field the user is
// looking at, so those kinds override the label for that key.
const PARAM_LABEL_OVERRIDES: Record<string, Record<string, string>> = {
  icmp: { timeout_ms: 'mform.perPingTimeout' },
  gateway: { timeout_ms: 'mform.perPingTimeout' },
}

/**
 * Check the numeric params the form exposes for this kind. Only fields the kind
 * actually consumes are checked, matching the server — a value left over from a
 * previous kind is ignored by that kind's collector and must not block the save.
 * Blank/NaN is "unset" (cleanParams drops it), not an error.
 */
export function paramsRangeError(kind: string, params: Record<string, unknown> | undefined): ParamRangeError | null {
  if (!params) return null
  const groups = [PARAM_RANGES.common, PARAM_RANGES[kind === 'gateway' ? 'icmp' : kind] ?? []]
  for (const group of groups) {
    for (const r of group) {
      const raw = params[r.key]
      if (raw === undefined || raw === null || raw === '') continue
      const v = Number(raw)
      if (!Number.isFinite(v)) continue // a non-numeric entry is dropped before save
      if (v < r.min || v > r.max) {
        return { labelKey: PARAM_LABEL_OVERRIDES[kind]?.[r.key] ?? r.labelKey, min: r.min, max: r.max }
      }
    }
  }
  return null
}

/**
 * Carry a target across a kind change. Switching kind keeps the old value, which
 * is how a URL ends up in a DNS monitor (and a bare host in an HTTP one) — so
 * convert between the two shapes rather than leaving a target that can only fail.
 * Anything it cannot convert is returned untouched for targetError to report.
 */
export function retargetForKind(target: string, fromKind: string, toKind: string): string {
  const s = target.trim()
  if (!s || fromKind === toKind) return target
  const hostKinds = new Set(['dns', 'icmp', 'tcp', 'nat'])
  // http → host-shaped: keep the host, drop scheme and path.
  if (fromKind === 'http' && hostKinds.has(toKind) && LEADING_SCHEME.test(s)) {
    let u: URL
    try {
      u = new URL(s)
    } catch {
      return target
    }
    // URL.hostname keeps the brackets around an IPv6 literal ("[2001:db8::1]"),
    // which every bare-host field rejects — strip them.
    const host = u.hostname.startsWith('[') && u.hostname.endsWith(']')
      ? u.hostname.slice(1, -1)
      : u.hostname
    // NAT is the one host-shaped kind with no separate port input: its endpoint IS
    // "host[:port]", so dropping the URL's port would silently repoint the monitor
    // at the default STUN port. Every other kind carries its port in its own field.
    if (toKind === 'nat' && u.port) {
      return u.hostname.startsWith('[') ? `${u.hostname}:${u.port}` : `${host}:${u.port}`
    }
    return host
  }
  // host-shaped → http: the scheme is what the probe needs; the normalizer on the
  // field adds it, so nothing to do here beyond leaving a clean host.
  return target
}
