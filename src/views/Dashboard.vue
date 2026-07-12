<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type Agent, type Device, type Quota, type Sample, type StatusEvent } from '../api'
import MetricChart from '../components/MetricChart.vue'
import { toDateLocale } from '../i18n'
import { fmtBps, fmtBytes } from '../lib/format'
import { natCodeLabel, natTone } from '../lib/metricMeta'

const { t, locale } = useI18n()

const SITE = 'site_default'
const agents = ref<Agent[]>([])
const selected = ref('')
const quota = ref<Quota | null>(null)
const statusHistory = ref<StatusEvent[]>([])
const rtt = ref<Sample[]>([])
const loss = ref<Sample[]>([])
const snapshot = ref<Sample[]>([])
const devices = ref<Device[]>([])
const error = ref('')
const loading = ref(true)
const refreshing = ref(false)
let timer: number | undefined
let loadSequence = 0

const currentAgent = computed(() => agents.value.find((agent) => agent.id === selected.value) ?? null)
const onlineCount = computed(() => agents.value.filter((agent) => agent.status === 'online').length)

async function loadAgents() {
  try {
    ;[agents.value, quota.value] = await Promise.all([api.agents(), api.quota()])
    // (Re)select when nothing is selected yet, or when the selected agent was
    // deleted — a stale id would pin every metric poll to a gone agent and
    // block auto-selecting newly enrolled ones.
    const stillExists = agents.value.some((a) => a.id === selected.value)
    if ((!selected.value || !stillExists) && agents.value.length) selected.value = agents.value[0].id
    else if (!stillExists) selected.value = ''
  } catch (e) {
    error.value = String((e as Error).message || e)
  } finally {
    loading.value = false
  }
}

async function loadMetrics() {
  if (!selected.value) return
  const sequence = ++loadSequence
  refreshing.value = true
  try {
    const id = selected.value
    const [nextRtt, nextLoss, nextSnapshot, nextDevices, nextHistory] = await Promise.all([
      api.metrics(id, 'probe.icmp.rtt_ms', { target: 'gateway' }),
      api.metrics(id, 'probe.icmp.loss_pct', { target: 'gateway' }),
      api.latest(id),
      api.listDevices(SITE),
      api.agentStatusHistory(id),
    ])
    if (sequence !== loadSequence) return
    rtt.value = nextRtt
    loss.value = nextLoss
    snapshot.value = nextSnapshot
    devices.value = nextDevices
    statusHistory.value = nextHistory
    error.value = ''
  } catch (e) {
    if (sequence === loadSequence) error.value = String((e as Error).message || e)
  } finally {
    if (sequence === loadSequence) refreshing.value = false
  }
}

async function changeAgent() {
  snapshot.value = []
  rtt.value = []
  loss.value = []
  statusHistory.value = []
  await loadMetrics()
}

const rowKey = (sample: Sample) => sample.monitor_id || sample.target
const byKind = (kind: string) => snapshot.value.filter((sample) => sample.kind === kind)
const byRowKey = (kind: string) => new Map(byKind(kind).map((sample) => [rowKey(sample), sample]))

const publicTargets = computed(() =>
  byKind('probe.icmp.rtt_ms')
    .filter((sample) => sample.target !== 'gateway')
    .sort((a, b) => a.target.localeCompare(b.target) || rowKey(a).localeCompare(rowKey(b))),
)
const dnsTargets = computed(() =>
  byKind('probe.dns.resolve_ms').sort(
    (a, b) => a.target.localeCompare(b.target) || rowKey(a).localeCompare(rowKey(b)),
  ),
)
const httpRows = computed(() => {
  const status = byRowKey('probe.http.status')
  const latency = byRowKey('probe.http.latency_ms')
  return [...status.keys()].sort().map((key) => ({
    key,
    url: status.get(key)!.target,
    status: status.get(key)!.value,
    latency: latency.get(key)?.value ?? null,
  }))
})
const interfaces = computed(() => byKind('iface.up').sort((a, b) => a.target.localeCompare(b.target)))

interface NATRow {
  key: string
  target: string
  code: number
  type: string
  tone: 'good' | 'bad' | 'unknown'
  mapping: string
  filtering: string
  reachable: boolean | null
  ts: string
}

const natRows = computed<NATRow[]>(() => {
  const types = byRowKey('probe.nat.type')
  const mappings = byRowKey('probe.nat.mapping')
  const filterings = byRowKey('probe.nat.filtering')
  const reachability = byRowKey('probe.nat.ok')
  return [...types.entries()]
    .map(([key, sample]) => {
      const mapping = mappings.get(key)
      const filtering = filterings.get(key)
      const ok = reachability.get(key)
      return {
        key,
        target: sample.target,
        code: Math.round(sample.value),
        type: natCodeLabel('probe.nat.type', sample.value),
        tone: natTone('probe.nat.type', sample.value),
        mapping: mapping ? natCodeLabel('probe.nat.mapping', mapping.value) : '—',
        filtering: filtering ? natCodeLabel('probe.nat.filtering', filtering.value) : '—',
        reachable: ok ? ok.value >= 0.5 : null,
        ts: sample.ts,
      }
    })
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
})
const primaryNAT = computed(() => natRows.value.find((row) => row.code > 0) ?? natRows.value[0] ?? null)

const hasHost = computed(() => snapshot.value.some((sample) => sample.kind.startsWith('host.')))
function hostVal(kind: string, target = 'host'): number | null {
  const sample = snapshot.value.find((item) => item.kind === kind && item.target === target)
  return sample?.value ?? null
}
const diskMounts = computed(() => [...new Set(byKind('host.disk.pct').map((sample) => sample.target))].sort())
const cpuCoreCount = computed(() => byKind('host.cpu.core.pct').length)
function fmtUptime(seconds: number | null): string {
  if (seconds == null) return '—'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return days ? `${days}d ${hours}h ${minutes}m` : hours ? `${hours}h ${minutes}m` : `${minutes}m`
}
function barClass(value: number | null): string {
  if (value == null) return 'is-unknown'
  return value < 60 ? 'is-good' : value < 85 ? 'is-warn' : 'is-bad'
}
function ringStyle(value: number | null): Record<string, string> {
  const pct = Math.max(0, Math.min(100, value ?? 0))
  return { '--usage-angle': `${pct * 3.6}deg` }
}
function loadPercent(value: number | null): number {
  const capacity = Math.max(cpuCoreCount.value, 1)
  return Math.max(0, Math.min(100, ((value ?? 0) / capacity) * 100))
}
function loadTone(value: number | null): string {
  const pct = loadPercent(value)
  return pct < 25 ? 'is-low' : pct < 60 ? 'is-normal' : pct < 85 ? 'is-high' : 'is-critical'
}
function loadLevel(value: number | null): string {
  const pct = loadPercent(value)
  return pct < 25 ? t('dashboard.loadLow') : pct < 60 ? t('dashboard.loadNormal') : pct < 85 ? t('dashboard.loadHigh') : t('dashboard.loadCritical')
}

function latestVal(samples: Sample[]): number | null {
  let latest: Sample | null = null
  for (const sample of samples) {
    if (!latest || new Date(sample.ts).getTime() > new Date(latest.ts).getTime()) latest = sample
  }
  return latest?.value ?? null
}
const gatewayRtt = computed(() => latestVal(rtt.value))
const gatewayLoss = computed(() => latestVal(loss.value))
const networkHealth = computed(() => {
  if (currentAgent.value?.status !== 'online') return { tone: 'bad', label: t('dashboard.healthOffline') }
  if (gatewayRtt.value == null && gatewayLoss.value == null) return { tone: 'unknown', label: t('dashboard.healthUnknown') }
  if ((gatewayLoss.value ?? 0) >= 2 || (gatewayRtt.value ?? 0) >= 150) {
    return { tone: 'warn', label: t('dashboard.healthAttention') }
  }
  return { tone: 'good', label: t('dashboard.healthGood') }
})

function metricTone(value: number | null, warn: number, bad: number): string {
  if (value == null) return 'is-unknown'
  return value >= bad ? 'is-bad' : value >= warn ? 'is-warn' : 'is-good'
}
const fmt = (value: number | null, digits = 0) => (value == null ? '—' : value.toFixed(digits))
const fmtTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString(toDateLocale(locale.value), { hour12: false }) : '—'

onMounted(async () => {
  await loadAgents()
  await loadMetrics()
  // Refresh agents alongside metrics: status now flips within seconds
  // server-side. loadAgents only assigns `selected` when it's empty, so the
  // current selection survives every refresh.
  timer = window.setInterval(() => {
    loadMetrics()
    loadAgents()
  }, 5000)
})
onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
})
</script>

<template>
  <main class="page dashboard-page">
    <header class="dashboard-head">
      <div>
        <div class="eyebrow"><span class="pulse-dot"></span>{{ t('dashboard.liveOverview') }}</div>
        <h2>{{ t('dashboard.title') }}</h2>
        <p>{{ t('dashboard.subtitle') }}</p>
      </div>
      <div v-if="agents.length" class="head-actions">
        <label class="agent-picker">
          <span>{{ t('dashboard.viewingAgent') }}</span>
          <select v-model="selected" @change="changeAgent">
            <option v-for="agent in agents" :key="agent.id" :value="agent.id">
              {{ agent.display_name || agent.hostname || agent.id }}
            </option>
          </select>
        </label>
        <button class="refresh-button" :class="{ spinning: refreshing }" :title="t('common.refresh')" @click="loadMetrics">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6v5h-5M4 18v-5h5M6.1 9a7 7 0 0 1 11.8-2.6L20 11M4 13l2.1 4.6A7 7 0 0 0 17.9 15" /></svg>
        </button>
      </div>
    </header>

    <p v-if="error" class="err dashboard-error">{{ error }}</p>

    <div v-if="loading" class="dashboard-loading">
      <span></span><span></span><span></span>
    </div>

    <div v-else-if="!agents.length" class="card empty">
      <div class="empty-ico">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
      </div>
      <h3>{{ t('common.noAgents') }}</h3>
      <p class="hint">{{ t('dashboard.noAgentHint') }}</p>
    </div>

    <template v-else>
      <section class="agent-hero" :class="`health-${networkHealth.tone}`">
        <div class="hero-glow"></div>
        <div class="agent-identity">
          <div class="agent-mark">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4M7 9h.01M10 9h7M7 12h.01M10 12h5" /></svg>
          </div>
          <div>
            <div class="agent-line">
              <h3>{{ currentAgent?.display_name || currentAgent?.hostname || currentAgent?.id }}</h3>
              <span class="status-chip" :class="currentAgent?.status === 'online' ? 'online' : 'offline'">
                <i></i>{{ currentAgent?.status === 'online' ? t('dashboard.statusOnline') : t('dashboard.statusOffline') }}
              </span>
            </div>
            <p>{{ currentAgent?.hostname }} · {{ currentAgent?.platform }}<template v-if="currentAgent?.agent_version"> · v{{ currentAgent.agent_version }}</template></p>
          </div>
        </div>
        <div class="health-summary">
          <span>{{ t('dashboard.networkHealth') }}</span>
          <strong>{{ networkHealth.label }}</strong>
          <small>{{ t('dashboard.updatedAt') }} {{ fmtTime(currentAgent?.last_seen_at) }}</small>
        </div>
        <div class="fleet-summary">
          <div><strong>{{ onlineCount }}</strong><span>/ {{ agents.length }} {{ t('dashboard.onlineAgents') }}</span></div>
          <div v-if="quota"><strong>{{ quota.used }}</strong><span>/ {{ quota.max === 0 ? '∞' : quota.max }} {{ t('dashboard.agentQuota') }}</span></div>
        </div>
      </section>

      <section class="metric-grid">
        <article class="metric-card" :class="metricTone(gatewayRtt, 50, 150)">
          <div class="metric-icon latency"><svg viewBox="0 0 24 24"><path d="M4 12h3l2-5 4 10 2-5h5" /></svg></div>
          <div class="metric-copy"><span>{{ t('dashboard.gatewayRtt') }}</span><strong>{{ fmt(gatewayRtt) }}<small>ms</small></strong><p>{{ t('dashboard.gatewayRttFoot') }}</p></div>
        </article>
        <article class="metric-card" :class="metricTone(gatewayLoss, 0.1, 2)">
          <div class="metric-icon loss"><svg viewBox="0 0 24 24"><path d="M5 19 19 5M7 7h.01M17 17h.01" /><circle cx="7" cy="7" r="2" /><circle cx="17" cy="17" r="2" /></svg></div>
          <div class="metric-copy"><span>{{ t('dashboard.gatewayLoss') }}</span><strong>{{ fmt(gatewayLoss, 1) }}<small>%</small></strong><p>{{ t('dashboard.gatewayLossFoot') }}</p></div>
        </article>
        <article class="metric-card nat-kpi" :class="primaryNAT ? `is-${primaryNAT.tone}` : 'is-unknown'">
          <div class="metric-icon nat"><svg viewBox="0 0 24 24"><path d="M12 3v4M5.6 5.6l2.8 2.8M3 12h4M5.6 18.4l2.8-2.8M12 17v4M18.4 18.4l-2.8-2.8M17 12h4M18.4 5.6l-2.8 2.8" /><circle cx="12" cy="12" r="5" /></svg></div>
          <div class="metric-copy"><span>{{ t('dashboard.natType') }}</span><strong class="nat-type-value">{{ primaryNAT?.type ?? t('dashboard.notDetected') }}</strong><p>{{ primaryNAT?.target ?? t('dashboard.natTypeFoot') }}</p></div>
        </article>
        <article class="metric-card is-info">
          <div class="metric-icon devices"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg></div>
          <div class="metric-copy"><span>{{ t('dashboard.lanDevices') }}</span><strong>{{ devices.length }}</strong><p>{{ t('dashboard.lanDevicesFoot') }}</p></div>
        </article>
      </section>

      <section class="overview-monitor-row dashboard-section" :class="{ 'without-host': !hasHost }">
      <section class="surface trend-surface">
        <div class="surface-head">
          <div><span class="section-kicker">{{ t('dashboard.performance') }}</span><h3>{{ t('dashboard.gatewayTrend') }}</h3></div>
          <span class="range-chip">{{ t('dashboard.recentWindow') }}</span>
        </div>
        <div class="combined-trend">
          <MetricChart
            :title="t('dashboard.chartGatewayCombined')"
            :metrics="[
              { key: 'rtt', label: t('dashboard.gatewayRtt'), kind: 'probe.icmp.rtt_ms', unit: 'ms', color: '#38bdf8', samples: rtt },
              { key: 'loss', label: t('dashboard.gatewayLoss'), kind: 'probe.icmp.loss_pct', unit: 'pct', color: '#f59e0b', samples: loss },
            ]"
          />
        </div>
      </section>

      <section v-if="hasHost" class="surface system-monitor-surface">
        <div class="surface-head compact">
          <div><span class="section-kicker">HOST</span><h3>{{ t('dashboard.systemStatus') }}</h3></div>
          <RouterLink class="icon-link" :to="{ path: '/host-metrics', query: { agent: selected } }">→</RouterLink>
        </div>
        <div class="system-monitor-grid">
          <div class="monitor-primary-column">
            <article class="monitor-card cpu-monitor-card">
              <div class="monitor-card-title">
                <span class="monitor-icon cpu"><svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3M9 9h6v6H9z"/></svg></span>
                <strong>{{ t('dashboard.cpuUsage') }}</strong>
              </div>
              <div class="cpu-monitor-body">
                <span class="monitor-big-value cpu-value">{{ fmt(hostVal('host.cpu.pct'), 1) }}%</span>
                <span class="usage-ring cpu-ring" :style="ringStyle(hostVal('host.cpu.pct'))"><i></i></span>
              </div>
              <p>{{ t('dashboard.logicalCores', { n: cpuCoreCount || '—' }) }}</p>
            </article>

            <article class="monitor-card memory-monitor-card">
              <div class="monitor-card-title">
                <span class="monitor-icon memory"><svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 10v4M11 10v4M15 10v4M19 10v4M6 4v3M10 4v3M14 4v3M18 4v3M6 17v3M10 17v3M14 17v3M18 17v3"/></svg></span>
                <strong>{{ t('dashboard.memory') }}</strong>
              </div>
              <span class="monitor-big-value memory-value">{{ fmt(hostVal('host.mem.pct'), 1) }}%</span>
              <div class="memory-progress"><i :style="{ width: `${hostVal('host.mem.pct') ?? 0}%` }"></i></div>
              <p>{{ fmtBytes(hostVal('host.mem.used')) }} / {{ fmtBytes(hostVal('host.mem.total')) }}</p>
            </article>
          </div>

          <div class="monitor-secondary-column">
            <article class="monitor-card load-monitor-card">
              <div class="monitor-card-title">
                <span class="monitor-icon load"><svg viewBox="0 0 24 24"><path d="M4 16a8 8 0 1 1 16 0M12 12l4-4M6 17h12"/></svg></span>
                <strong>{{ t('dashboard.systemLoad') }}</strong>
              </div>
              <div class="load-levels">
                <div v-for="period in [{ label: '1m', kind: 'host.load.1m' }, { label: '5m', kind: 'host.load.5m' }, { label: '15m', kind: 'host.load.15m' }]" :key="period.kind" class="load-level-item" :class="loadTone(hostVal(period.kind))">
                  <div class="load-level-head"><span>{{ period.label }}</span><em>{{ loadLevel(hostVal(period.kind)) }}</em></div>
                  <strong>{{ fmt(hostVal(period.kind), 2) }}</strong>
                  <div class="load-level-track"><i :style="{ width: `${Math.max(hostVal(period.kind) ? 4 : 0, loadPercent(hostVal(period.kind)))}%` }"></i></div>
                </div>
              </div>
            </article>

            <article class="monitor-card io-monitor-card">
              <div class="monitor-card-title">
                <span class="monitor-icon io"><svg viewBox="0 0 24 24"><path d="M4 19V5M4 19h16M7 15l4-4 3 2 5-7"/></svg></span>
                <strong>{{ t('dashboard.networkIO') }}</strong>
              </div>
              <div class="io-values">
                <div><span class="io-arrow up">↑</span><span>{{ t('dashboard.upload') }}</span><strong>{{ fmtBps(hostVal('host.net.tx_bps')) }}</strong></div>
                <div><span class="io-arrow down">↓</span><span>{{ t('dashboard.download') }}</span><strong>{{ fmtBps(hostVal('host.net.rx_bps')) }}</strong></div>
              </div>
            </article>

            <article class="monitor-card uptime-monitor-card">
              <span class="monitor-icon uptime"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/></svg></span>
              <div><span>{{ t('dashboard.uptime') }}</span><strong>{{ fmtUptime(hostVal('host.uptime_s')) }}</strong></div>
            </article>
          </div>
        </div>
      </section>
      </section>

      <section class="surface services-surface dashboard-section">
        <div class="surface-head">
          <div><span class="section-kicker">{{ t('dashboard.monitoring') }}</span><h3>{{ t('dashboard.serviceStatus') }}</h3></div>
          <RouterLink class="text-link" to="/target-status">{{ t('dashboard.viewAll') }} →</RouterLink>
        </div>
        <div class="service-columns">
          <div class="service-group">
            <div class="service-title"><span class="service-symbol icmp"><svg viewBox="0 0 24 24"><path d="M3 12h4l2-5 4 10 2-5h6"/></svg></span><strong>{{ t('dashboard.publicReach') }}</strong><b>{{ publicTargets.length }}</b></div>
            <div v-if="!publicTargets.length" class="mini-empty">{{ t('common.noData') }}</div>
            <div v-for="sample in publicTargets.slice(0, 4)" :key="rowKey(sample)" class="service-row">
              <span class="target-name mono">{{ sample.target }}</span><span class="value">{{ sample.value.toFixed(0) }} ms</span>
            </div>
          </div>
          <div class="service-group">
            <div class="service-title"><span class="service-symbol dns"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 4 6 4 9s-1 6-4 9c-3-3-4-6-4-9s1-6 4-9z"/></svg></span><strong>{{ t('dashboard.dnsResolve') }}</strong><b>{{ dnsTargets.length }}</b></div>
            <div v-if="!dnsTargets.length" class="mini-empty">{{ t('dashboard.noDataDns') }}</div>
            <div v-for="sample in dnsTargets.slice(0, 4)" :key="rowKey(sample)" class="service-row">
              <span class="target-name mono">{{ sample.target }}</span><span class="value">{{ sample.value.toFixed(0) }} ms</span>
            </div>
          </div>
          <div class="service-group">
            <div class="service-title"><span class="service-symbol http"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/></svg></span><strong>{{ t('dashboard.httpTitle') }}</strong><b>{{ httpRows.length }}</b></div>
            <div v-if="!httpRows.length" class="mini-empty">{{ t('dashboard.noDataHttp') }}</div>
            <div v-for="row in httpRows.slice(0, 4)" :key="row.key" class="service-row">
              <span class="target-name mono">{{ row.url }}</span>
              <span class="http-status" :class="row.status >= 200 && row.status < 400 ? 'good' : 'bad'">{{ row.status }}</span>
              <span class="value">{{ row.latency == null ? '—' : `${row.latency.toFixed(0)} ms` }}</span>
            </div>
          </div>
          <div class="service-group">
            <div class="service-title"><span class="service-symbol nat"><svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><path d="M12 7v4M5 16v-3h14v3M12 11v2"/></svg></span><strong>{{ t('dashboard.natDetails') }}</strong><b>{{ natRows.length }}</b></div>
            <div v-if="!natRows.length" class="mini-empty">{{ t('dashboard.notDetected') }}</div>
            <div v-for="row in natRows.slice(0, 4)" :key="row.key" class="service-row nat-service-row">
              <span class="nat-service-copy"><strong>{{ row.type }}</strong><small class="mono">{{ row.target }}</small></span>
              <span class="reach-chip" :class="row.reachable === true ? 'good' : row.reachable === false ? 'bad' : ''">{{ row.reachable === true ? t('dashboard.reachable') : row.reachable === false ? t('dashboard.unreachable') : '—' }}</span>
            </div>
          </div>
        </div>
      </section>

      <section class="variable-grid equal-grid dashboard-section">
        <section class="surface overview-resource-panel devices-surface">
          <div class="resource-panel-head">
            <span class="resource-panel-icon devices"><svg viewBox="0 0 24 24"><path d="M4 10a11 11 0 0 1 16 0M7 13a7 7 0 0 1 10 0M10 16a3 3 0 0 1 4 0"/><circle cx="12" cy="19" r="1"/></svg></span>
            <h3>{{ t('dashboard.lanDevices') }}</h3>
            <span>{{ t('dashboard.deviceCount', { n: devices.length }) }}</span>
          </div>
          <div v-if="!devices.length" class="mini-empty padded">{{ t('dashboard.noDeviceYet') }}</div>
          <div v-else class="resource-column-list">
            <article v-for="device in devices" :key="device.mac" class="resource-list-card device-item">
              <span class="resource-item-icon device"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg></span>
              <span class="resource-item-copy"><strong>{{ device.hostname || device.ip }}</strong><small class="mono">{{ device.hostname ? `${device.ip} · ${device.mac}` : device.mac }}</small></span>
            </article>
          </div>
        </section>

        <section class="surface overview-resource-panel interface-surface">
          <div class="resource-panel-head">
            <span class="resource-panel-icon interfaces"><svg viewBox="0 0 24 24"><rect x="5" y="7" width="14" height="10" rx="2"/><path d="M9 11h6M12 7V3M12 17v4M8 3h8"/></svg></span>
            <h3>{{ t('dashboard.ifaceStatus') }}</h3>
            <span>{{ t('dashboard.interfaceCount', { n: interfaces.length }) }}</span>
          </div>
          <div v-if="!interfaces.length" class="mini-empty padded">{{ t('common.noData') }}</div>
          <div v-else class="resource-column-list">
            <article v-for="item in interfaces" :key="item.target" class="resource-list-card interface-item">
              <span class="resource-item-icon interface"><svg viewBox="0 0 24 24"><path d="M5 8h14v8H5zM9 12h6M12 8V4M12 16v4"/></svg></span>
              <span class="resource-item-copy"><strong>{{ item.target }}</strong><small>{{ t('dashboard.networkInterface') }}</small></span>
              <span class="resource-state" :class="item.value === 1 ? 'good' : 'bad'">{{ item.value === 1 ? '↑ UP' : '↓ DOWN' }}</span>
            </article>
          </div>
        </section>

        <section class="surface overview-resource-panel disk-surface">
          <div class="resource-panel-head">
            <span class="resource-panel-icon disks"><svg viewBox="0 0 24 24"><path d="M5 4h14l2 5v10H3V9l2-5zM3 10h18M7 15h.01M11 15h6"/></svg></span>
            <h3>{{ t('dashboard.diskStatus') }}</h3>
            <span>{{ t('dashboard.diskCount', { n: diskMounts.length }) }}</span>
          </div>
          <div v-if="!diskMounts.length" class="mini-empty padded">{{ t('common.noData') }}</div>
          <div v-else class="resource-column-list">
            <article v-for="mount in diskMounts" :key="mount" class="resource-list-card disk-item" :class="barClass(hostVal('host.disk.pct', mount))">
              <span class="resource-item-icon disk"><svg viewBox="0 0 24 24"><path d="M4 6h16v12H4zM4 14h16M8 17h.01M12 17h4"/></svg></span>
              <span class="resource-item-copy"><strong class="mono">{{ mount }}</strong><small>{{ t('dashboard.storage') }}</small></span>
              <strong class="disk-percent">{{ fmt(hostVal('host.disk.pct', mount), 1) }}%</strong>
              <span class="disk-progress"><i :style="{ width: `${hostVal('host.disk.pct', mount) ?? 0}%` }"></i></span>
              <small class="disk-capacity">{{ fmtBytes(hostVal('host.disk.used', mount)) }} / {{ fmtBytes(hostVal('host.disk.total', mount)) }}</small>
            </article>
          </div>
        </section>

        <section class="surface overview-resource-panel activity-surface">
          <div class="resource-panel-head">
            <span class="resource-panel-icon activity"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/></svg></span>
            <h3>{{ t('dashboard.recentActivity') }}</h3>
            <span>{{ t('dashboard.activityCount', { n: statusHistory.length }) }}</span>
          </div>
          <div v-if="!statusHistory.length" class="mini-empty padded">{{ t('dashboard.noStatusChange') }}</div>
          <div v-else class="activity-timeline">
            <div v-for="(event, index) in statusHistory" :key="`${event.changed_at}-${index}`" class="timeline-event">
              <span class="timeline-marker" :class="event.status === 'online' ? 'good' : 'bad'"><i>{{ event.status === 'online' ? '↑' : '↓' }}</i></span>
              <span class="timeline-content">
                <strong>{{ event.status === 'online' ? t('dashboard.statusOnline') : t('dashboard.statusOffline') }}</strong>
                <small>{{ t('dashboard.agentStateChanged') }}</small>
              </span>
              <time :datetime="event.changed_at">{{ fmtTime(event.changed_at) }}</time>
            </div>
          </div>
        </section>
      </section>
    </template>
  </main>
</template>

<style scoped>
.dashboard-page { max-width: 1440px; padding-top: 32px; }
.dashboard-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 24px; }
.dashboard-head h2 { font-size: clamp(26px, 3vw, 34px); letter-spacing: -0.035em; }
.dashboard-head p { margin: 6px 0 0; color: var(--text-muted); }
.eyebrow, .section-kicker { color: var(--primary); font-size: 10px; font-weight: 750; letter-spacing: .14em; text-transform: uppercase; }
.eyebrow { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }
.pulse-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--success); box-shadow: 0 0 0 5px var(--success-soft); }
.head-actions { display: flex; align-items: flex-end; gap: 10px; }
.agent-picker { display: grid; gap: 5px; }
.agent-picker > span { padding-left: 2px; font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
.agent-picker select { min-width: 240px; height: 42px; background: var(--surface); backdrop-filter: blur(12px); }
.refresh-button { display: grid; place-items: center; width: 42px; height: 42px; color: var(--text-dim); border: 1px solid var(--border-strong); border-radius: 11px; background: var(--surface); cursor: pointer; }
.refresh-button:hover { color: var(--primary); border-color: var(--primary); }
.refresh-button svg { width: 17px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.refresh-button.spinning svg { animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.dashboard-error { margin-bottom: 16px; }
.dashboard-loading { display: flex; justify-content: center; gap: 8px; padding: 100px; }
.dashboard-loading span { width: 7px; height: 7px; border-radius: 50%; background: var(--primary); animation: bounce 1s infinite alternate; }
.dashboard-loading span:nth-child(2) { animation-delay: .2s; }.dashboard-loading span:nth-child(3) { animation-delay: .4s; }
@keyframes bounce { to { transform: translateY(-8px); opacity: .35; } }
.empty { display: grid; place-items: center; text-align: center; gap: 8px; padding: 64px 20px; }
.empty-ico { display: grid; place-items: center; width: 64px; height: 64px; color: var(--primary); background: var(--primary-soft); border-radius: 20px; }
.empty-ico svg { width: 30px; }

.agent-hero { position: relative; display: grid; grid-template-columns: minmax(260px, 1.5fr) minmax(170px, .8fr) auto; align-items: center; gap: 28px; min-height: 144px; margin-bottom: 18px; padding: 28px 30px; overflow: hidden; border: 1px solid var(--border); border-radius: 22px; background: linear-gradient(120deg, color-mix(in srgb, var(--surface-solid) 88%, transparent), var(--surface)); box-shadow: var(--shadow); }
.agent-hero::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 4px; background: var(--text-muted); }
.agent-hero.health-good::before { background: var(--success); }.agent-hero.health-warn::before { background: var(--warning); }.agent-hero.health-bad::before { background: var(--danger); }
.hero-glow { position: absolute; width: 380px; height: 240px; right: 16%; top: -160px; border-radius: 50%; background: var(--primary); opacity: .1; filter: blur(50px); pointer-events: none; }
.agent-identity { display: flex; align-items: center; gap: 16px; min-width: 0; z-index: 1; }
.agent-mark { display: grid; place-items: center; width: 58px; height: 58px; flex: none; color: var(--primary); border: 1px solid color-mix(in srgb, var(--primary) 30%, transparent); border-radius: 17px; background: var(--primary-soft); }
.agent-mark svg { width: 28px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.agent-line { display: flex; align-items: center; gap: 10px; min-width: 0; }.agent-line h3 { overflow: hidden; font-size: 20px; text-overflow: ellipsis; white-space: nowrap; }
.agent-identity p { margin: 5px 0 0; color: var(--text-muted); font-size: 12px; }
.status-chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; font-size: 10px; font-weight: 700; border-radius: 999px; }
.status-chip i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }.status-chip.online { color: var(--success); background: var(--success-soft); }.status-chip.offline { color: var(--danger); background: var(--danger-soft); }
.health-summary { display: grid; gap: 3px; z-index: 1; }.health-summary > span { color: var(--text-muted); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }.health-summary strong { font-size: 22px; }.health-summary small { color: var(--text-muted); font-size: 11px; }
.health-good .health-summary strong { color: var(--success); }.health-warn .health-summary strong { color: var(--warning); }.health-bad .health-summary strong { color: var(--danger); }
.fleet-summary { display: flex; gap: 26px; padding-left: 26px; border-left: 1px solid var(--border); z-index: 1; }.fleet-summary div { display: grid; }.fleet-summary strong { font-size: 24px; line-height: 1.1; }.fleet-summary span { color: var(--text-muted); font-size: 10px; white-space: nowrap; }

.metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 18px; }
.metric-card { position: relative; display: flex; align-items: center; gap: 14px; min-height: 126px; padding: 20px; overflow: hidden; border: 1px solid var(--border); border-radius: 18px; background: var(--surface); box-shadow: var(--shadow-soft); }
.metric-card::after { content: ''; position: absolute; right: -28px; bottom: -42px; width: 110px; height: 110px; border-radius: 50%; background: currentColor; opacity: .045; }
.metric-card.is-good { color: var(--success); }.metric-card.is-warn { color: var(--warning); }.metric-card.is-bad { color: var(--danger); }.metric-card.is-unknown, .metric-card.is-info { color: var(--primary); }
.metric-icon { display: grid; place-items: center; width: 46px; height: 46px; flex: none; color: currentColor; border-radius: 14px; background: color-mix(in srgb, currentColor 12%, transparent); }
.metric-icon svg { width: 23px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.metric-copy { min-width: 0; }.metric-copy > span { display: block; color: var(--text-muted); font-size: 11px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; }.metric-copy strong { display: block; margin-top: 5px; overflow: hidden; color: var(--text); font-size: 27px; line-height: 1.15; letter-spacing: -.025em; text-overflow: ellipsis; white-space: nowrap; }.metric-copy strong small { margin-left: 4px; color: var(--text-muted); font-size: 12px; font-weight: 500; }.metric-copy p { margin: 5px 0 0; overflow: hidden; color: var(--text-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }.metric-copy .nat-type-value { font-size: clamp(17px, 1.7vw, 23px); }

.dashboard-section { margin-bottom: 18px; }
.surface { border: 1px solid var(--border); border-radius: 18px; background: var(--surface); box-shadow: var(--shadow-soft); backdrop-filter: blur(14px); overflow: hidden; }
.surface-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 20px 14px; }.surface-head.compact { padding-bottom: 14px; border-bottom: 1px solid var(--border); }.surface-head h3 { margin-top: 3px; font-size: 16px; }.range-chip, .count-chip { padding: 4px 9px; color: var(--text-muted); font-size: 10px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface-2); }.text-link, .icon-link { color: var(--primary); font-size: 12px; }.icon-link { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; background: var(--primary-soft); }
.overview-monitor-row { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(360px, .9fr); align-items: stretch; gap: 18px; }.overview-monitor-row .system-monitor-surface { grid-column: 1; grid-row: 1; }.overview-monitor-row .trend-surface { display: flex; flex-direction: column; grid-column: 2; grid-row: 1; min-width: 0; }.overview-monitor-row.without-host .trend-surface { grid-column: 1 / -1; }.combined-trend { flex: none; height: 340px; min-height: 0; }.combined-trend :deep(.chart) { height: 340px; min-height: 0; }
.services-surface { padding-bottom: 4px; }.service-columns { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-top: 1px solid var(--border); }.service-group { min-width: 0; padding: 16px 18px; }.service-group + .service-group { border-left: 1px solid var(--border); }.service-title { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }.service-title strong { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }.service-title b { margin-left: auto; color: var(--text-muted); font-size: 10px; }.service-symbol { display: grid; place-items: center; width: 29px; height: 29px; flex: none; border-radius: 9px; }.service-symbol svg { width: 17px; height: 17px; overflow: visible; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }.service-symbol.icmp { color: var(--primary); background: var(--primary-soft); }.service-symbol.dns { color: #818cf8; background: rgba(129,140,248,.13); }.service-symbol.http { color: #ec4899; background: rgba(236,72,153,.12); }.service-symbol.nat { color: var(--success); background: var(--success-soft); }
.service-row { display: flex; align-items: center; gap: 7px; min-height: 31px; border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent); }.service-row:first-of-type { border-top: 0; }.target-name { flex: 1; overflow: hidden; color: var(--text-dim); text-overflow: ellipsis; white-space: nowrap; }.service-row .value { color: var(--text); font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }.http-status { padding: 1px 5px; font-size: 9px; font-weight: 700; border-radius: 5px; }.http-status.good { color: var(--success); background: var(--success-soft); }.http-status.bad { color: var(--danger); background: var(--danger-soft); }.mini-empty { padding: 16px 0; color: var(--text-muted); font-size: 11px; }.mini-empty.padded { padding: 28px 20px; text-align: center; }

.system-monitor-surface { padding-bottom: 16px; }.system-monitor-grid { display: grid; grid-template-columns: minmax(280px, .95fr) minmax(420px, 1.25fr); gap: 14px; padding: 16px; }.monitor-primary-column, .monitor-secondary-column { display: grid; gap: 14px; min-width: 0; }.monitor-primary-column { grid-template-rows: 1fr 1fr; }.monitor-secondary-column { grid-template-rows: auto 1fr auto; }.monitor-card { min-width: 0; padding: 18px 20px; border: 1px solid var(--border); border-radius: 14px; background: linear-gradient(145deg, var(--surface-2), color-mix(in srgb, var(--surface-2) 72%, var(--primary-soft))); box-shadow: inset 0 1px rgba(255,255,255,.025); }.monitor-card-title { display: flex; align-items: center; gap: 10px; }.monitor-card-title > strong { font-size: 14px; }.monitor-icon { display: grid; place-items: center; width: 30px; height: 30px; flex: none; border-radius: 9px; }.monitor-icon svg { width: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }.monitor-icon.cpu { color: var(--success); background: var(--success-soft); }.monitor-icon.memory, .monitor-icon.load, .monitor-icon.io, .monitor-icon.uptime { color: var(--primary); background: var(--primary-soft); }.monitor-big-value { display: block; margin-top: 14px; font-size: clamp(34px, 4vw, 48px); font-weight: 700; line-height: 1; letter-spacing: -.04em; font-variant-numeric: tabular-nums; }.cpu-value { color: var(--success); }.memory-value { color: var(--primary); }.monitor-card p { margin: 12px 0 0; color: var(--text-muted); font-size: 12px; }.cpu-monitor-body { display: flex; align-items: center; justify-content: space-between; gap: 20px; }.usage-ring { --usage-angle: 0deg; position: relative; display: block; width: 70px; height: 70px; flex: none; border-radius: 50%; background: conic-gradient(var(--success) var(--usage-angle), color-mix(in srgb, var(--success) 13%, var(--surface-2)) 0); }.usage-ring::after { content: ''; position: absolute; inset: 9px; border-radius: 50%; background: var(--surface-solid); }.usage-ring i { position: absolute; inset: 16px; z-index: 1; border-radius: 50%; background: var(--surface-2); }.memory-progress { height: 8px; margin-top: 18px; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, var(--primary) 12%, var(--surface)); }.memory-progress i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--primary-strong), var(--primary)); box-shadow: 0 0 12px var(--primary-glow); }.load-monitor-card { padding-bottom: 14px; }.load-dials { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 10px; }.load-dial-item { display: grid; justify-items: center; min-width: 0; }.load-dial-item > span { margin-top: -2px; color: var(--text-muted); font-size: 11px; white-space: nowrap; }.load-dial-item > span strong { color: var(--text); }.load-dial { --needle-angle: -125deg; position: relative; width: 74px; height: 48px; overflow: hidden; }.load-dial::before { content: ''; position: absolute; left: 5px; top: 5px; width: 64px; height: 64px; border-radius: 50%; background: conic-gradient(from 225deg, var(--success) 0 17%, var(--primary) 17% 36%, var(--warning) 36% 50%, var(--danger) 50% 56%, transparent 56% 100%); -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 9px), #000 0); mask: radial-gradient(farthest-side, transparent calc(100% - 9px), #000 0); opacity: .9; }.load-dial i { position: absolute; left: 36px; bottom: 4px; width: 2px; height: 27px; z-index: 1; border-radius: 2px; background: var(--text); transform: rotate(var(--needle-angle)); transform-origin: 50% 100%; }.load-dial b { position: absolute; left: 32px; bottom: 0; width: 10px; height: 10px; z-index: 2; border: 3px solid var(--surface-solid); border-radius: 50%; background: var(--text); }.io-monitor-card { display: grid; align-content: center; }.io-values { display: grid; gap: 10px; margin-top: 14px; }.io-values > div { display: grid; grid-template-columns: 24px 70px 1fr; align-items: center; gap: 6px; }.io-values span { color: var(--text-muted); }.io-values strong { font-size: 16px; font-variant-numeric: tabular-nums; }.io-arrow { font-size: 22px; line-height: 1; }.io-arrow.up { color: var(--success); }.io-arrow.down { color: var(--primary); }.uptime-monitor-card { display: flex; align-items: center; gap: 14px; padding-top: 14px; padding-bottom: 14px; }.uptime-monitor-card > div { display: grid; }.uptime-monitor-card span { color: var(--text-muted); font-size: 11px; }.uptime-monitor-card strong { margin-top: 2px; font-size: 20px; font-variant-numeric: tabular-nums; }
.resource-card { display: grid; align-content: center; min-width: 0; min-height: 92px; padding: 15px 16px; border: 1px solid var(--border); border-radius: 13px; background: var(--surface-2); }.resource-card > div:first-child { display: flex; justify-content: space-between; gap: 12px; font-size: 11px; }.resource-card span { color: var(--text-muted); }.resource-card em { margin-left: 4px; color: var(--text-dim); font-style: normal; }.resource-card strong { font-variant-numeric: tabular-nums; }.resource-card > small { display: block; margin-top: 5px; color: var(--text-muted); font-size: 9px; text-align: right; }.resource-track { height: 5px; margin-top: 9px; overflow: hidden; border-radius: 99px; background: var(--surface); }.resource-track i { display: block; height: 100%; border-radius: inherit; background: var(--primary); }.resource-track i.is-good { background: var(--success); }.resource-track i.is-warn { background: var(--warning); }.resource-track i.is-bad { background: var(--danger); }

/* Keep the system monitor compact enough that the dual-axis gateway chart has
   a genuinely useful plot width when both panels share one row. */
.overview-monitor-row { grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 14px; }
.system-monitor-grid { grid-template-columns: minmax(210px, .9fr) minmax(320px, 1.1fr); gap: 10px; padding: 12px; }
.monitor-primary-column,
.monitor-secondary-column { gap: 10px; }
.monitor-card { padding: 12px 14px; border-radius: 12px; }
.monitor-card-title { gap: 8px; }
.monitor-card-title > strong { font-size: 13px; }
.monitor-icon { width: 27px; height: 27px; border-radius: 8px; }
.monitor-icon svg { width: 17px; }
.monitor-big-value { margin-top: 9px; font-size: clamp(30px, 3vw, 40px); }
.monitor-card p { margin-top: 8px; font-size: 11px; }
.cpu-monitor-body { gap: 12px; }
.usage-ring { width: 58px; height: 58px; }
.usage-ring::after { inset: 7px; }
.usage-ring i { inset: 13px; }
.memory-progress { height: 7px; margin-top: 12px; }
.load-monitor-card { padding-bottom: 9px; }
.load-dials { gap: 6px; margin-top: 5px; }
.load-dial { width: 66px; height: 42px; transform: scale(.88); transform-origin: center bottom; }
.load-dial-item > span { font-size: 10px; }
.io-values { gap: 6px; margin-top: 8px; }
.io-values > div { grid-template-columns: 20px 54px 1fr; gap: 4px; }
.io-values strong { font-size: 14px; }
.io-arrow { font-size: 19px; }
.uptime-monitor-card { gap: 10px; padding-top: 10px; padding-bottom: 10px; }
.uptime-monitor-card strong { font-size: 17px; }
.load-levels { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
.load-level-item { --load-color: var(--success); min-width: 0; padding: 8px 9px; border: 1px solid var(--border); border-radius: 10px; background: color-mix(in srgb, var(--surface) 58%, transparent); }
.load-level-head { display: flex; align-items: center; justify-content: space-between; gap: 5px; }
.load-level-head > span { color: var(--text-muted); font-size: 10px; font-weight: 650; }
.load-level-head em { padding: 1px 5px; color: var(--load-color); font-size: 8px; font-style: normal; font-weight: 750; border-radius: 999px; background: color-mix(in srgb, var(--load-color) 13%, transparent); white-space: nowrap; }
.load-level-item > strong { display: block; margin-top: 4px; color: var(--load-color); font-size: 18px; line-height: 1.1; font-variant-numeric: tabular-nums; }
.load-level-track { height: 4px; margin-top: 7px; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, var(--load-color) 12%, var(--surface)); }
.load-level-track i { display: block; height: 100%; border-radius: inherit; background: var(--load-color); box-shadow: 0 0 7px color-mix(in srgb, var(--load-color) 45%, transparent); }
.load-level-item.is-normal { --load-color: var(--primary); }
.load-level-item.is-high { --load-color: var(--warning); }
.load-level-item.is-critical { --load-color: var(--danger); }

.variable-grid { display: grid; gap: 18px; }.equal-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); align-items: stretch; }.equal-grid > .surface { height: 100%; }.tile-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px; padding: 14px; }.stack-list { display: grid; gap: 10px; padding: 14px; }.list-row { display: flex; align-items: center; min-width: 0; min-height: 55px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 11px; background: var(--surface-2); }.list-icon { display: grid; place-items: center; width: 32px; height: 32px; flex: none; color: var(--primary); border-radius: 9px; background: var(--primary-soft); }.list-icon svg { width: 17px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }.list-main { display: grid; min-width: 0; flex: 1; }.list-main strong, .list-main small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.list-main strong { font-size: 11px; }.list-main small, .list-meta { color: var(--text-muted); font-size: 9px; }.list-meta { max-width: 42%; text-align: right; }.state-label { display: inline-flex; align-items: center; gap: 5px; font-size: 9px; font-weight: 700; }.state-label i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }.state-label.good { color: var(--success); }.state-label.bad { color: var(--danger); }.timeline-dot { width: 8px; height: 8px; flex: none; border: 2px solid var(--surface-solid); border-radius: 50%; box-shadow: 0 0 0 2px var(--border-strong); }.timeline-dot.good { background: var(--success); }.timeline-dot.bad { background: var(--danger); }

.nat-service-copy { display: grid; min-width: 0; flex: 1; }.nat-service-copy strong, .nat-service-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.nat-service-copy strong { font-size: 11px; }.nat-service-copy small { color: var(--text-muted); font-size: 9px; }.reach-chip { margin-left: auto; padding: 2px 7px; color: var(--text-muted); font-size: 9px; border-radius: 999px; background: var(--surface); }.reach-chip.good { color: var(--success); background: var(--success-soft); }.reach-chip.bad { color: var(--danger); background: var(--danger-soft); }.disk-card { min-height: 92px; }
.activity-timeline { display: grid; padding: 16px 14px 18px; }.timeline-event { position: relative; display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; align-items: start; gap: 9px; min-height: 58px; padding-bottom: 12px; }.timeline-event:last-child { min-height: 34px; padding-bottom: 0; }.timeline-event:not(:last-child)::before { content: ''; position: absolute; left: 8px; top: 17px; bottom: -1px; width: 1px; background: linear-gradient(var(--border-strong), var(--border)); }.timeline-marker { position: relative; display: grid; place-items: center; width: 17px; height: 17px; z-index: 1; border: 1px solid var(--border-strong); border-radius: 50%; background: var(--surface-solid); box-shadow: 0 0 0 3px var(--surface); }.timeline-marker i { width: 7px; height: 7px; border-radius: 50%; background: var(--text-muted); }.timeline-marker.good i { background: var(--success); box-shadow: 0 0 7px color-mix(in srgb, var(--success) 65%, transparent); }.timeline-marker.bad i { background: var(--danger); box-shadow: 0 0 7px color-mix(in srgb, var(--danger) 65%, transparent); }.timeline-content { display: grid; min-width: 0; }.timeline-content strong { font-size: 11px; line-height: 1.35; }.timeline-content small { margin-top: 2px; color: var(--text-muted); font-size: 9px; }.timeline-event time { padding-top: 1px; color: var(--text-muted); font-size: 9px; font-variant-numeric: tabular-nums; white-space: nowrap; }

/* Bottom resource columns: dense vertical cards inspired by a monitoring rack. */
.overview-resource-panel { background: linear-gradient(160deg, var(--surface), color-mix(in srgb, var(--surface) 88%, var(--primary-soft))); }
.resource-panel-head { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; align-items: center; gap: 10px; min-height: 70px; padding: 14px 16px; border-bottom: 1px solid var(--border); }
.resource-panel-head h3 { font-size: 15px; }
.resource-panel-head > span:last-child { color: var(--text-muted); font-size: 11px; white-space: nowrap; }
.resource-panel-icon { display: grid; place-items: center; width: 32px; height: 32px; color: var(--primary); border-radius: 10px; background: var(--primary-soft); }
.resource-panel-icon svg { width: 22px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.resource-panel-icon.devices { color: #60a5fa; background: rgba(96,165,250,.13); }
.resource-panel-icon.interfaces { color: #38bdf8; background: rgba(56,189,248,.13); }
.resource-panel-icon.disks { color: #5eead4; background: rgba(94,234,212,.12); }
.resource-panel-icon.activity { color: #93c5fd; background: rgba(147,197,253,.13); }
.resource-column-list { display: grid; align-content: start; gap: 8px; padding: 12px; }
.resource-list-card { display: grid; grid-template-columns: 38px minmax(0, 1fr) auto; align-items: center; gap: 10px; min-width: 0; min-height: 64px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 11px; background: var(--surface-2); box-shadow: inset 0 1px rgba(255,255,255,.025); }
.resource-item-icon { display: grid; place-items: center; width: 36px; height: 36px; color: var(--primary); border-radius: 9px; background: var(--primary-soft); }
.resource-item-icon svg { width: 20px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.resource-item-copy { display: grid; min-width: 0; }
.resource-item-copy strong, .resource-item-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.resource-item-copy strong { font-size: 12px; }
.resource-item-copy small { margin-top: 2px; color: var(--text-muted); font-size: 9px; }
.resource-state { font-size: 11px; font-weight: 750; white-space: nowrap; }
.resource-state.good { color: var(--success); }
.resource-state.bad { color: var(--danger); }
.disk-item { grid-template-rows: auto auto; }
.disk-percent { font-size: 18px; font-variant-numeric: tabular-nums; }
.disk-item.is-good .disk-percent { color: var(--success); }
.disk-item.is-warn .disk-percent { color: var(--warning); }
.disk-item.is-bad .disk-percent { color: var(--danger); }
.disk-progress { grid-column: 2 / -1; height: 6px; overflow: hidden; border-radius: 999px; background: var(--surface); }
.disk-progress i { display: block; height: 100%; border-radius: inherit; background: var(--success); }
.disk-item.is-warn .disk-progress i { background: var(--warning); }
.disk-item.is-bad .disk-progress i { background: var(--danger); }
.disk-capacity { grid-column: 2 / -1; margin-top: -5px; color: var(--text-muted); font-size: 9px; text-align: right; }
.overview-resource-panel .activity-timeline { padding: 14px 14px 18px; }
.overview-resource-panel .timeline-event { grid-template-columns: 28px minmax(0, 1fr) auto; gap: 10px; min-height: 68px; }
.overview-resource-panel .timeline-event:not(:last-child)::before { left: 13px; top: 27px; bottom: -1px; background: linear-gradient(color-mix(in srgb, var(--success) 45%, var(--border)), var(--border)); }
.overview-resource-panel .timeline-marker { width: 27px; height: 27px; border: 0; box-shadow: none; }
.overview-resource-panel .timeline-marker i { display: grid; place-items: center; width: 27px; height: 27px; color: #fff; font-size: 15px; font-style: normal; font-weight: 750; }
.overview-resource-panel .timeline-marker.good i { background: color-mix(in srgb, var(--success) 75%, #164e3b); box-shadow: 0 0 12px color-mix(in srgb, var(--success) 32%, transparent); }
.overview-resource-panel .timeline-marker.bad i { background: color-mix(in srgb, var(--danger) 75%, #641f2b); box-shadow: 0 0 12px color-mix(in srgb, var(--danger) 32%, transparent); }
.overview-resource-panel .timeline-content strong { font-size: 12px; }
.overview-resource-panel .timeline-event time { padding-top: 5px; }

@media (max-width: 1120px) { .metric-grid { grid-template-columns: repeat(2, 1fr); }.service-columns { grid-template-columns: repeat(2, minmax(0, 1fr)); }.service-group:nth-child(odd) { border-left: 0; }.service-group:nth-child(n + 3) { border-top: 1px solid var(--border); }.agent-hero { grid-template-columns: 1fr auto; }.fleet-summary { grid-column: 1 / -1; padding: 16px 0 0; border-top: 1px solid var(--border); border-left: 0; } }
@media (max-width: 1280px) { .overview-monitor-row { grid-template-columns: 1fr; }.overview-monitor-row .system-monitor-surface { grid-column: 1; grid-row: 1; }.overview-monitor-row .trend-surface { grid-column: 1; grid-row: 2; }.combined-trend, .combined-trend :deep(.chart) { height: 320px; min-height: 0; } }
@media (max-width: 900px) { .system-monitor-grid { grid-template-columns: 1fr; }.monitor-primary-column { grid-template-columns: 1fr 1fr; grid-template-rows: auto; }.monitor-secondary-column { grid-template-columns: 1fr 1fr; grid-template-rows: auto; }.load-monitor-card { grid-column: 1 / -1; } }
@media (max-width: 760px) { .dashboard-page { padding: 22px 16px 42px; }.dashboard-head { align-items: stretch; flex-direction: column; }.head-actions, .agent-picker { width: 100%; }.agent-picker { flex: 1; }.agent-picker select { width: 100%; min-width: 0; }.agent-hero { grid-template-columns: 1fr; padding: 22px; }.health-summary { padding-top: 16px; border-top: 1px solid var(--border); }.fleet-summary { grid-column: auto; }.metric-grid, .service-columns, .equal-grid, .monitor-primary-column, .monitor-secondary-column { grid-template-columns: 1fr; }.load-monitor-card { grid-column: auto; }.service-group + .service-group { border-top: 1px solid var(--border); border-left: 0; }.metric-card { min-height: 108px; }.service-group { padding: 14px 16px; }.tile-grid, .stack-list, .system-monitor-grid { padding: 12px; }.load-dials { gap: 8px; }.io-values > div { grid-template-columns: 24px 60px 1fr; } }
@media (max-width: 420px) { .metric-grid { grid-template-columns: 1fr; }.fleet-summary { flex-direction: column; gap: 12px; }.agent-identity { align-items: flex-start; }.agent-line { align-items: flex-start; flex-direction: column; gap: 4px; } }
</style>
