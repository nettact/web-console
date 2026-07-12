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

// NAT behavior/type results are categorical codes, not trend values: they render
// as labeled stat cards (a raw-integer line carries no meaning). Together with the
// static capacity totals (mem.total) they are "info" kinds — shown as a card or
// caption, never plotted as a flat, unchanging line.
export const NAT_CODE_KINDS = new Set(['probe.nat.mapping', 'probe.nat.filtering', 'probe.nat.type'])
export const INFO_KINDS = new Set(['host.mem.total', ...NAT_CODE_KINDS])

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

// Display order for a group's metrics (picker, cards, chart legend). Kinds not
// listed keep their original listSeries order (stable sort). The load averages
// are the reason this exists — listSeries returns them lexically (15m, 1m, 5m).
const METRIC_ORDER = [
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
  'probe.icmp.loss_pct': '#fbbf24',
  'probe.icmp.jitter_ms': '#a78bfa',
  'probe.dns.resolve_ms': '#818cf8',
  'probe.dns.ok': '#34d399',
  'probe.http.status': '#5eead4',
  'probe.http.latency_ms': '#f472b6',
  'probe.http.ok': '#34d399',
  'iface.up': '#34d399',
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

// The series a monitor's overview card samples to show current up/down and
// availability. Most probe families have a boolean `.ok`; ICMP has none, so
// reachability is derived from loss (100% loss ⇒ down). `toUp` normalizes a raw
// sample value to a 0/1 "up" value for the timeline helpers.
export interface StatusSource {
  kind: string
  toUp: (v: number) => number
}
const asBool = (v: number) => (v >= 0.5 ? 1 : 0)
export function statusSource(family: string): StatusSource | null {
  switch (family) {
    case 'probe.icmp':
      return { kind: 'probe.icmp.loss_pct', toUp: (v) => (v < 100 ? 1 : 0) }
    case 'probe.dns':
      return { kind: 'probe.dns.ok', toUp: asBool }
    case 'probe.http':
      return { kind: 'probe.http.ok', toUp: asBool }
    case 'probe.tcp':
      return { kind: 'probe.tcp.ok', toUp: asBool }
    case 'probe.nat':
      return { kind: 'probe.nat.ok', toUp: asBool }
    default:
      return null
  }
}

// Plain numeric format: integers as-is, otherwise one decimal.
export const fmtNum = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1))
