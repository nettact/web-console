// Parsing for the agent-generated `remote_addr` strings shown on the Live
// Connections page, plus the quick-add-monitor decision built on top of them.
//
// The agent (see agent/internal/hostsnapshot/collect.go `addr`) emits exactly
// one of these shapes:
//   IPv4   "ip:port"     e.g. "203.0.113.7:443"
//   IPv6   "[ip]:port"   e.g. "[2001:db8::1]:443"
//   empty  ""
// The port is always present in a non-empty address (it may be 0). Everything
// here is pure so it can be unit-tested without a DOM.

export interface ParsedRemote {
  /** Bare IP with no brackets. May be empty for a portless/degenerate address. */
  ip: string
  /** Port as an integer in 1-65535, or null when absent/out of range. */
  port: number | null
}

// A port is valid only as an integer 1-65535 written in plain decimal digits.
function parsePort(s: string): number | null {
  if (!/^\d+$/.test(s)) return null
  const n = Number(s)
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null
}

// Split an agent `remote_addr` into its bare IP and optional port. Returns null
// only when there is no address at all.
export function parseRemoteAddr(raw: string | null | undefined): ParsedRemote | null {
  if (!raw) return null
  const s = raw.trim()
  if (!s) return null
  if (s.startsWith('[')) {
    // Bracketed IPv6: "[ip]:port". Anything after "]" is ":port" or empty.
    const close = s.indexOf(']')
    if (close < 0) return null
    const ip = s.slice(1, close)
    const rest = s.slice(close + 1)
    const port = rest.startsWith(':') ? parsePort(rest.slice(1)) : null
    return { ip, port }
  }
  // IPv4 "ip:port": exactly one colon separates host and port. An unbracketed
  // string with more than one colon is a defensive bare IPv6 literal (the agent
  // brackets IPv6, so this shouldn't occur) — keep it whole with no port.
  const first = s.indexOf(':')
  if (first < 0 || first !== s.lastIndexOf(':')) return { ip: s, port: null }
  return { ip: s.slice(0, first), port: parsePort(s.slice(first + 1)) }
}

// A remote IP is a usable monitor target unless it is empty or an unspecified
// address. Loopback is intentionally allowed.
export function isUsableIp(ip: string): boolean {
  return ip !== '' && ip !== '0.0.0.0' && ip !== '::'
}

// Query for the /monitoring/new prefill, mirroring MonitorForm's accepted shape:
// a TCP monitor carries a port; every other protocol becomes an ICMP monitor
// with no port key.
export type QuickAddQuery =
  | { kind: 'tcp'; target: string; port: string }
  | { kind: 'icmp'; target: string }

// Decide the quick-add-monitor query for a connection row, or null when the row
// offers no usable action. TCP-family protocols (proto starting with "tcp")
// require a valid remote port; all other protocols link as ICMP.
export function quickAddQuery(
  proto: string,
  remoteAddr: string | null | undefined,
): QuickAddQuery | null {
  const parsed = parseRemoteAddr(remoteAddr)
  if (!parsed || !isUsableIp(parsed.ip)) return null
  if (proto.startsWith('tcp')) {
    if (parsed.port == null) return null
    return { kind: 'tcp', target: parsed.ip, port: String(parsed.port) }
  }
  return { kind: 'icmp', target: parsed.ip }
}
