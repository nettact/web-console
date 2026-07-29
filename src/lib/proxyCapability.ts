import type { ProbeParams, Proxy, ProxyType } from '../api'

// Mirror of protocol/config/proxy.go's ProxyCapable — which probe kinds can run
// through which proxy transport.
//
// It exists here for the same reason targetValidation.ts mirrors probevalidate.go:
// the console must not OFFER a combination the server will reject and the agent
// could only refuse. The Go function stays authoritative (the server validates every
// save and the agent re-checks every push); this copy exists so the picker shows the
// right options and explains itself before a round trip.
//
// Keep the two in lockstep. The matrix follows from what each transport carries:
//
//   kind     | socks5             | http               | wireguard
//   ---------+--------------------+--------------------+----------
//   http     | yes                | yes                | yes
//   tcp      | yes                | yes                | yes
//   dns      | yes                | stream protos only | yes
//   nat      | yes                | tcp/tls only       | yes
//   icmp     | no                 | no                 | yes
//   gateway  | no                 | no                 | no
//   host     | no                 | no                 | no
//
// The columns differ by what each transport can forward:
//   - SOCKS5 forwards TCP (CONNECT) and UDP (UDP ASSOCIATE), so every datagram probe
//     except ICMP works. It has no ICMP relay — the protocol has no command for it.
//   - HTTP has only CONNECT, a TCP byte stream, so plain-UDP DNS and STUN over
//     udp/dtls cannot traverse it.
//   - WireGuard carries raw IP, so it carries everything the agent probes.
// A gateway probe targets the local first hop, where an egress proxy has no meaning.

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase()

export function proxyCapable(kind: string, params: ProbeParams | undefined, type: ProxyType): boolean {
  const p = params ?? {}
  if (type === 'socks5') {
    // Relays both TCP and UDP, so the only exclusion is ICMP plus the non-network kinds.
    if (kind === 'dns') return proxiedDNSHasEndpoint(p)
    return ['http', 'tcp', 'nat'].includes(kind)
  }
  if (type === 'http') {
    switch (kind) {
      case 'http':
      case 'tcp':
        return true
      case 'dns':
        // Only the stream-framed resolver protocols ride a CONNECT tunnel. '' (system
        // resolver) and 'udp' are datagram DNS.
        return ['tcp', 'dot', 'doh'].includes(norm(p.resolver_protocol)) && proxiedDNSHasEndpoint(p)
      case 'nat':
        // STUN over a TCP-framed transport tunnels; udp and dtls do not ('' = udp).
        return ['tcp', 'tls'].includes(norm(p.nat_transport))
      default:
        return false
    }
  }
  if (type === 'wireguard') {
    // Everything the agent probes is IP traffic and the tunnel carries IP — ICMP and
    // UDP included — so only the local/server-side anchors are out.
    if (kind === 'dns') return proxiedDNSHasEndpoint(p)
    return ['icmp', 'http', 'tcp', 'nat'].includes(kind)
  }
  return false
}

// proxiedDNSHasEndpoint mirrors the Go helper of the same name: a DNS monitor with no
// resolver server uses the SYSTEM resolver, which has no address on the wire for any
// proxy or tunnel to carry. Allowing it would let the query resolve off the host and
// report success while the pinned egress was down.
function proxiedDNSHasEndpoint(p: ProbeParams): boolean {
  return (p.resolver_server ?? '').trim() !== ''
}

// anyProxyCapable decides whether the proxy picker should appear at all. A kind no
// transport can carry must not grow a control the user could only leave empty.
export function anyProxyCapable(kind: string, params: ProbeParams | undefined): boolean {
  return (
    proxyCapable(kind, params, 'socks5') ||
    proxyCapable(kind, params, 'http') ||
    proxyCapable(kind, params, 'wireguard')
  )
}

// usableProxies filters a site's proxies to the ones this monitor can actually use:
// enabled, and of a transport that can carry this kind.
export function usableProxies(
  proxies: Proxy[],
  kind: string,
  params: ProbeParams | undefined,
): Proxy[] {
  return proxies.filter((p) => p.enabled && proxyCapable(kind, params, p.type))
}

// proxyUnusableReason explains why a currently-selected proxy cannot be used, so a
// selection invalidated by an unrelated edit (switching the kind, changing the
// resolver protocol) says what happened instead of silently vanishing. Returns an
// i18n key, or '' when the selection is fine.
export function proxyUnusableReason(
  proxy: Proxy | undefined,
  kind: string,
  params: ProbeParams | undefined,
): string {
  if (!proxy) return ''
  if (!proxyCapable(kind, params, proxy.type)) return 'pform.selectedIncapable'
  return ''
}

// proxyDisabledWarning reports whether a selection points at a DISABLED proxy. It is
// deliberately separate from proxyUnusableReason: a disabled pin is valid, so it warns
// but must not block a save.
//
// That distinction matters because disabling an in-use proxy is a supported action —
// the server keeps the pin and the agent fails the monitor closed, which is the whole
// design. Treating it as unsavable made every unrelated edit (a rename, a group move)
// impossible until the proxy came back. Returns an i18n key, or '' when fine.
export function proxyDisabledWarning(proxy: Proxy | undefined): string {
  return proxy && !proxy.enabled ? 'pform.selectedDisabled' : ''
}
