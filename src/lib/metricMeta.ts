// Pure metric metadata shared by the Host Metrics and Target Status pages:
// colors, families, ordering, NAT code labels, time ranges, and status-kind
// classification. No i18n here — label resolution that needs translations lives
// in composables/useMetricMeta.ts. Extracted from the old History view so both
// pages (and the shared components) agree on one source of truth.

export type Tone = 'good' | 'bad' | 'unknown'

// `label` is an i18n key (metrics.range.*), resolved by the component.
export const RANGES = [
  { label: 'metrics.range.h1', sec: 3600 },
  { label: 'metrics.range.h6', sec: 6 * 3600 },
  { label: 'metrics.range.h24', sec: 24 * 3600 },
  { label: 'metrics.range.d7', sec: 7 * 86400 },
  { label: 'metrics.range.d30', sec: 30 * 86400 },
]

// agent.wal_pending is an internal buffer depth, not a user-facing target — hide it.
export const HIDDEN_KINDS = new Set(['agent.wal_pending'])

// The server serves raw (unaggregated) samples only for ranges up to 2h; beyond
// that /metrics returns bucket averages. Categorical CODE_KINDS must never be
// averaged (avg of code 0 and 2 is a meaningless 1), so their cards fetch within
// this window to read the true latest value. Mirrors server-core pickTier.
export const RAW_MAX_SEC = 2 * 3600

// NAT behavior/type results are categorical codes, not trend values: they render
// as labeled stat cards (a raw-integer line carries no meaning). The TCP
// error-class is the same shape (a diagnostic code, not a trend), so both are
// "code kinds". Together with the static capacity totals (mem.total) and the
// per-cycle ICMP sample count they are "info" kinds — shown as a card or caption,
// never plotted as a flat, meaningless line.
export const NAT_CODE_KINDS = new Set(['probe.nat.mapping', 'probe.nat.filtering', 'probe.nat.type'])
export const TCP_ERROR_KIND = 'probe.tcp.error_class'
export const CODE_KINDS = new Set([...NAT_CODE_KINDS, TCP_ERROR_KIND])
export const INFO_KINDS = new Set(['host.mem.total', 'probe.icmp.samples', ...CODE_KINDS])

// natCodeLabel maps a NAT result code to its category label. These are the RFC
// 4787 / RFC 3489 terms, shown verbatim in English (they are standardized terms;
// translating them reads poorly). The localized explanation of each category is
// carried by the neighboring info tooltip (useMetricMeta.natInfo).
export const NAT_BEHAVIOR_LABELS = ['Unknown', 'Endpoint-Independent', 'Address-Dependent', 'Address-and-Port-Dependent']
export const NAT_TYPE_LABELS = ['Unknown', 'Open Internet', 'Full Cone', 'Restricted Cone', 'Port-Restricted Cone', 'Symmetric']
export function natCodeLabel(kind: string, code: number): string {
  const n = Math.round(code)
  const list = kind === 'probe.nat.type' ? NAT_TYPE_LABELS : NAT_BEHAVIOR_LABELS
  return list[n] ?? 'Unknown'
}
export function natTone(kind: string, code: number): Tone {
  const n = Math.round(code)
  if (n === 0) return 'unknown'
  if (kind === 'probe.nat.type') return n >= 5 ? 'bad' : n <= 2 ? 'good' : 'unknown'
  return n >= 3 ? 'bad' : n === 1 ? 'good' : 'unknown'
}

// tcpErrorTone maps a probe.tcp.error_class code to a card tone: 0 (none) is the
// healthy state, any other class is a failure. The human label is localized in
// useMetricMeta.tcpErrorLabel (the codes are telemetry.TCPErr*).
export function tcpErrorTone(code: number): Tone {
  return Math.round(code) === 0 ? 'good' : 'bad'
}

// Display order for a group's metrics (picker, cards, chart legend). Kinds not
// listed keep their original listSeries order (stable sort). The load averages
// are the reason this exists — listSeries returns them lexically (15m, 1m, 5m).
const METRIC_ORDER = [
  // Probe stability metrics: RTT distribution, then jitter/loss/samples, so the
  // detail cards and legend read best-case → worst-case → stability → volume.
  'probe.icmp.rtt_ms',
  'probe.icmp.rtt_min_ms',
  'probe.icmp.rtt_max_ms',
  'probe.icmp.jitter_ms',
  'probe.icmp.loss_pct',
  'probe.icmp.samples',
  'probe.tcp.ok',
  'probe.tcp.connect_ms',
  'probe.tcp.dns_ms',
  'probe.tcp.tls_ms',
  'probe.tcp.error_class',
  'host.mem.pct',
  'host.mem.used',
  'host.mem.free',
  'host.mem.total',
  'host.net.rx_bps',
  'host.net.tx_bps',
  'host.load.1m',
  'host.load.5m',
  'host.load.15m',
  'host.uptime_s',
  'wifi.up',
  'wifi.signal_dbm',
  'wifi.quality_pct',
  'wifi.link_rx_mbps',
  'wifi.link_tx_mbps',
]
export const orderOf = (kind: string) => {
  const i = METRIC_ORDER.indexOf(kind)
  return i < 0 ? METRIC_ORDER.length : i
}

// A "monitoring target" is a probe endpoint (or interface / the agent itself);
// its metrics (RTT, loss, …) are dimensions of that one target. The family is the
// kind's leading segment(s): probe.* keeps two (probe.icmp), others keep one.
export const familyOf = (kind: string) =>
  kind.startsWith('probe.') ? kind.split('.').slice(0, 2).join('.') : kind.split('.')[0]

const KIND_COLORS: Record<string, string> = {
  'probe.icmp.rtt_ms': '#38bdf8',
  'probe.icmp.rtt_min_ms': '#7dd3fc',
  'probe.icmp.rtt_max_ms': '#0284c7',
  'probe.icmp.loss_pct': '#fbbf24',
  'probe.icmp.jitter_ms': '#a78bfa',
  'probe.icmp.samples': '#94a3b8',
  'probe.dns.resolve_ms': '#818cf8',
  'probe.dns.ok': '#34d399',
  'probe.http.status': '#5eead4',
  'probe.http.latency_ms': '#f472b6',
  'probe.http.ok': '#34d399',
  'probe.tcp.ok': '#34d399',
  'probe.tcp.connect_ms': '#38bdf8',
  'probe.tcp.dns_ms': '#818cf8',
  'probe.tcp.tls_ms': '#f472b6',
  'probe.tcp.error_class': '#f87171',
  'iface.up': '#34d399',
  'wifi.up': '#34d399',
  'wifi.signal_dbm': '#38bdf8',
  'wifi.quality_pct': '#a78bfa',
  'wifi.link_rx_mbps': '#5eead4',
  'wifi.link_tx_mbps': '#f472b6',
  'agent.uptime_s': '#38bdf8',
  'host.cpu.pct': '#38bdf8',
  'host.disk.used': '#818cf8',
  'host.disk.free': '#34d399',
}
export const FALLBACK = ['#38bdf8', '#fbbf24', '#a78bfa', '#f472b6', '#818cf8', '#34d399']
export const kindColor = (k: string) => KIND_COLORS[k] || FALLBACK[Math.abs(hash(k)) % FALLBACK.length]
function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}

// Status kinds render as a state-timeline band (on/off) rather than a trend line:
// booleans (iface.up, probe.*.ok) plus the agent uptime counter.
export const isStatusKind = (kind: string, unit: string) => unit === 'bool' || kind === 'agent.uptime_s'

// The Target Status page owns probe.* results (user-created monitors). The Host
// Metrics page owns the host's own hardware: host.* + iface.* + agent.uptime_s.
export const isTargetStatusKind = (kind: string) => kind.startsWith('probe.')

// Plain numeric format: integers as-is, otherwise one decimal.
export const fmtNum = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1))
