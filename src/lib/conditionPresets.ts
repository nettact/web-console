// Condition presets for the group-rule editor. A preset hides the raw
// metric + comparator + threshold model behind a plain-language label, keyed by
// the probe kind of the target a condition is bound to. This is the client-side
// mirror of server-core rules.metricAllowedForKind: every preset's metric is one
// the target's kind can actually emit, so a saved condition can always fire.
//
// No i18n here — `label`/`unit` carry i18n keys (or raw units) that the editor
// resolves. Extracted from the old per-target MonitorForm so the group-rule
// editor is the single owner of the catalog.

import type { ProbeTarget } from '../api'

// A Preset is a plain-language alarm condition. `fixed` presets are on/off
// failures (no number to enter); the rest compare a measured value (`unit`,
// seeded from `def`) against a user-entered threshold. `scale` bridges a
// user-friendly display unit and the raw metric unit: the entered/shown value is
// in `unit`, the stored threshold is value × scale (network is stored bytes/s but
// entered as MB/s with scale 1048576). Omit → 1.
export interface Preset {
  key: string
  label: string
  metric: string
  comparator: string
  fixed?: number
  unit?: string
  def?: number
  scale?: number
}

const MIB = 1024 * 1024 // matches the dashboard's base-1024 byte formatting

// Probe-kind presets. Gateway shares ICMP's metrics (it emits probe.icmp.*).
const PROBE_PRESETS: Record<string, Preset[]> = {
  icmp: [
    { key: 'down', label: 'mform.condDown', metric: 'probe.icmp.loss_pct', comparator: 'gte', fixed: 100 },
    { key: 'loss', label: 'mform.condLoss', metric: 'probe.icmp.loss_pct', comparator: 'gt', unit: '%', def: 50 },
    { key: 'rtt', label: 'mform.condLatency', metric: 'probe.icmp.rtt_ms', comparator: 'gt', unit: 'ms', def: 200 },
    { key: 'rttmax', label: 'mform.condLatencyMax', metric: 'probe.icmp.rtt_max_ms', comparator: 'gt', unit: 'ms', def: 400 },
    { key: 'jitter', label: 'mform.condJitter', metric: 'probe.icmp.jitter_ms', comparator: 'gt', unit: 'ms', def: 30 },
  ],
  dns: [
    { key: 'fail', label: 'mform.condResolveFail', metric: 'probe.dns.ok', comparator: 'lt', fixed: 1 },
    { key: 'slow', label: 'mform.condResolveSlow', metric: 'probe.dns.resolve_ms', comparator: 'gt', unit: 'ms', def: 500 },
  ],
  http: [
    { key: 'down', label: 'mform.condUnavailable', metric: 'probe.http.ok', comparator: 'lt', fixed: 1 },
    { key: 'slow', label: 'mform.condLatency', metric: 'probe.http.latency_ms', comparator: 'gt', unit: 'ms', def: 1000 },
  ],
  tcp: [
    { key: 'down', label: 'mform.condConnectFail', metric: 'probe.tcp.ok', comparator: 'lt', fixed: 1 },
    { key: 'slow', label: 'mform.condConnectSlow', metric: 'probe.tcp.connect_ms', comparator: 'gt', unit: 'ms', def: 1000 },
    { key: 'dnsslow', label: 'mform.condDnsSlow', metric: 'probe.tcp.dns_ms', comparator: 'gt', unit: 'ms', def: 500 },
  ],
  nat: [
    { key: 'p2p', label: 'mform.condNatP2P', metric: 'probe.nat.type', comparator: 'gte', fixed: 5 },
    { key: 'probefail', label: 'mform.condNatProbeFail', metric: 'probe.nat.ok', comparator: 'lt', fixed: 1 },
  ],
}

// Host presets depend on the anchor's subject (its target string): whole-machine
// metrics on the "host" series, disk usage on a per-mount series, Wi-Fi on the
// per-adapter wifi.* series (anchored at "*"). Splitting this way guarantees a
// condition's metric matches its anchor target so it can fire.
export type HostSubject = 'whole' | 'disk' | 'wifi'
const HOST_PRESETS: Record<HostSubject, Preset[]> = {
  whole: [
    { key: 'cpu', label: 'mform.condCpu', metric: 'host.cpu.pct', comparator: 'gt', unit: '%', def: 90 },
    { key: 'mem', label: 'mform.condMem', metric: 'host.mem.pct', comparator: 'gt', unit: '%', def: 90 },
    { key: 'load1', label: 'mform.condLoad1', metric: 'host.load.1m', comparator: 'gt', unit: '', def: 4 },
    { key: 'load5', label: 'mform.condLoad5', metric: 'host.load.5m', comparator: 'gt', unit: '', def: 4 },
    { key: 'load15', label: 'mform.condLoad15', metric: 'host.load.15m', comparator: 'gt', unit: '', def: 4 },
    { key: 'netrx', label: 'mform.condNetRx', metric: 'host.net.rx_bps', comparator: 'gt', unit: 'MB/s', def: 100, scale: MIB },
    { key: 'nettx', label: 'mform.condNetTx', metric: 'host.net.tx_bps', comparator: 'gt', unit: 'MB/s', def: 100, scale: MIB },
  ],
  disk: [{ key: 'disk', label: 'mform.condDisk', metric: 'host.disk.pct', comparator: 'gt', unit: '%', def: 90 }],
  wifi: [
    { key: 'disconnected', label: 'mform.condWifiDown', metric: 'wifi.up', comparator: 'lt', fixed: 1 },
    { key: 'signal', label: 'mform.condWifiSignal', metric: 'wifi.signal_dbm', comparator: 'lt', unit: 'dBm', def: -70 },
    { key: 'quality', label: 'mform.condWifiQuality', metric: 'wifi.quality_pct', comparator: 'lt', unit: '%', def: 60 },
  ],
}

// hostSubjectOf derives a host anchor's subject from its target string:
// "host" → whole machine, "*" → Wi-Fi, anything else (a mount point) → disk.
export function hostSubjectOf(target: string): HostSubject {
  if (target === 'host') return 'whole'
  if (target === '*') return 'wifi'
  return 'disk'
}

// A literal IPv4/IPv6 address (bracketed IPv6 allowed) — used to hide the DNS
// phase preset that can never produce samples for such a TCP target.
function isLiteralIP(target: string): boolean {
  const s = target.trim()
  if (!s) return false
  const v6 = s.startsWith('[') && s.endsWith(']') ? s.slice(1, -1) : s
  if (v6.includes(':')) return /^[0-9a-fA-F:]+$/.test(v6)
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(s)
}

// presetsForTarget returns the condition presets a rule may use against one
// target, filtered to metrics the target's current config can actually emit.
export function presetsForTarget(t: ProbeTarget): Preset[] {
  if (t.kind === 'host') return HOST_PRESETS[hostSubjectOf(t.target)]
  const kind = t.kind === 'gateway' ? 'icmp' : t.kind
  let list = PROBE_PRESETS[kind] || []
  if ((t.kind === 'icmp' || t.kind === 'gateway') && t.params?.packet_count === 1) {
    // Jitter needs ≥2 received echoes; an explicit single-packet cycle never emits it.
    list = list.filter((p) => p.metric !== 'probe.icmp.jitter_ms')
  }
  if (t.kind === 'tcp' && isLiteralIP(t.target)) {
    // A literal-IP TCP target has no DNS phase, so probe.tcp.dns_ms is never emitted.
    list = list.filter((p) => p.metric !== 'probe.tcp.dns_ms')
  }
  return list
}

// presetKeyForCondition reverse-maps a stored (metric, comparator) to its preset
// key among a target's presets, so an existing condition renders on its preset.
// Fixed presets also match on comparator; falls back to the first preset.
export function presetKeyForCondition(t: ProbeTarget, metric: string, comparator: string): string {
  const list = presetsForTarget(t)
  const p = list.find((x) => x.metric === metric && (x.fixed == null || x.comparator === comparator))
  return (p || list[0])?.key ?? ''
}

export function presetByKey(t: ProbeTarget, key: string): Preset | undefined {
  return presetsForTarget(t).find((p) => p.key === key)
}

// Comparators the server accepts, with an i18n label key (comparator.*).
export const COMPARATORS = ['gt', 'gte', 'lt', 'lte', 'eq'] as const
// Severity levels, with an i18n label key (mform.sev_*).
export const SEVERITIES = ['info', 'warn', 'error', 'critical'] as const
// Incident layers a rule can correlate under (incidents.layer.*).
export const LAYERS = ['local', 'lan', 'wan', 'internet', 'dns', 'service', 'wireless'] as const

// Server bounds mirrored for client-side pre-validation (rules.validate).
export const FAIL_THRESHOLD_MAX = 100000
export const FOR_SECONDS_MAX = 86400
