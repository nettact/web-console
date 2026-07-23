<script setup lang="ts">
// Host Metrics: historical trends for one agent's own machine — CPU (total +
// cores), disk capacity, the memory/network/load overview, and the agent runtime
// state. Probe targets (ICMP/DNS/HTTP/NAT/interfaces) live on the Target Status
// page instead. Data flow: agents → listSeries → groups → metrics, with monotonic
// request tokens so a slow response for an old selection can't clobber the current.
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { api, type Agent, type Alert, type Sample, type SeriesInfo } from '../api'
import MetricChart from '../components/MetricChart.vue'
import RangePicker from '../components/RangePicker.vue'
import MetricStatCards from '../components/MetricStatCards.vue'
import AlertsTable from '../components/AlertsTable.vue'
import { useMetricMeta } from '../composables/useMetricMeta'
import { useMetricCards } from '../composables/useMetricCards'
import { FALLBACK, HIDDEN_KINDS, INFO_KINDS, familyOf, isStatusKind, kindColor, orderOf } from '../lib/metricMeta'
import { fmtBytes } from '../lib/format'

const { t } = useI18n()
const route = useRoute()
const { metricLabel } = useMetricMeta()
const { buildCards } = useMetricCards()

const agents = ref<Agent[]>([])
const agentId = ref('')
const series = ref<SeriesInfo[]>([])
const targetKey = ref('')
const selectedKinds = ref<string[]>([])
const rangeSec = ref(6 * 3600)
const samplesByKind = ref<Record<string, Sample[]>>({})
const alerts = ref<Alert[]>([])
const error = ref('')
const loading = ref(false)
let dataSeq = 0
let alertSeq = 0

interface HostGroup {
  key: string
  label: string
  target: string
  metrics: SeriesInfo[]
  collection?: Collection
}
type Collection = 'cpu' | 'disk' | 'iface' | 'wifi' | 'netio'

// Group host series: CPU (total + cores), disk, the network interfaces, and the
// Wi-Fi adapters each collapse into one collection; the remaining host metrics
// (memory/network/load/uptime) share the overview group; the agent uptime
// counter is its own runtime group.
const SECTION_ORDER: Record<string, number> = {
  'host::cpu': 0,
  'host::disk': 1,
  'iface::all': 2,
  'wifi::all': 3,
  'host::network': 4,
  'host::overview': 5,
  'agent::runtime': 6,
}
function classify(s: SeriesInfo): { key: string; label: string; collection?: Collection } {
  if (s.kind === 'host.cpu.pct' || s.kind === 'host.cpu.core.pct')
    return { key: 'host::cpu', label: t('hostMetrics.sysCpu'), collection: 'cpu' }
  if (s.kind.startsWith('host.disk.')) return { key: 'host::disk', label: t('hostMetrics.sysDisk'), collection: 'disk' }
  if (s.kind === 'host.net.rx_bps' || s.kind === 'host.net.tx_bps')
    return { key: 'host::network', label: t('hostMetrics.sysNetwork'), collection: 'netio' }
  if (familyOf(s.kind) === 'iface') return { key: 'iface::all', label: t('hostMetrics.sysIface'), collection: 'iface' }
  if (familyOf(s.kind) === 'wifi') return { key: 'wifi::all', label: t('hostMetrics.sysWifi'), collection: 'wifi' }
  if (familyOf(s.kind) === 'host') return { key: 'host::overview', label: t('hostMetrics.sysOverview') }
  return { key: 'agent::runtime', label: t('hostMetrics.agentRuntime') }
}

const groups = computed<HostGroup[]>(() => {
  const m = new Map<string, HostGroup>()
  for (const s of series.value) {
    if (HIDDEN_KINDS.has(s.kind)) continue
    const c = classify(s)
    let g = m.get(c.key)
    if (!g) {
      g = { key: c.key, target: s.target, label: c.label, metrics: [], collection: c.collection }
      m.set(c.key, g)
    }
    g.metrics.push(s)
  }
  for (const g of m.values()) g.metrics.sort((a, b) => orderOf(a.kind) - orderOf(b.kind))
  // Total CPU % lives primarily in its own CPU section, but we also surface it as
  // the headline metric at the very top of the System overview. Inject after the
  // per-group sort so it stays first regardless of METRIC_ORDER.
  const totalCpu = series.value.find((s) => s.kind === 'host.cpu.pct')
  if (totalCpu) {
    let overview = m.get('host::overview')
    if (!overview) {
      overview = { key: 'host::overview', target: totalCpu.target, label: t('hostMetrics.sysOverview'), metrics: [] }
      m.set('host::overview', overview)
    }
    if (!overview.metrics.some((mm) => mm.kind === 'host.cpu.pct')) overview.metrics.unshift(totalCpu)
  }
  return [...m.values()].sort((a, b) => (SECTION_ORDER[a.key] ?? 9) - (SECTION_ORDER[b.key] ?? 9))
})

const selectedGroup = computed(() => groups.value.find((g) => g.key === targetKey.value) || null)

// --- Collection views (CPU / disk): several charts driven by one selection ---
const collSamples = ref<Record<string, Sample[]>>({})
const ckey = (kind: string, target: string) => `${kind} ${target}`
const coreNum = (target: string) => {
  const m = /(\d+)/.exec(target)
  return m ? +m[1] : 0
}
const coreLabel = (target: string) => {
  const m = /(\d+)/.exec(target)
  return m ? t('hostMetrics.coreLabel', { n: m[1] }) : target
}

interface CollSeries {
  key: string
  label: string
  kind: string
  target: string
  unit: string
  color: string
}
interface CollChart {
  id: string
  title: string
  series: CollSeries[]
  hidden?: CollSeries[]
  totalKey?: string
  status?: boolean // true = a bool status-band chart (interfaces), so show an up/down legend
}

const collectionCharts = computed<CollChart[]>(() => {
  const g = selectedGroup.value
  if (!g?.collection) return []
  if (g.collection === 'cpu') {
    const charts: CollChart[] = []
    if (g.metrics.some((m) => m.kind === 'host.cpu.pct')) {
      charts.push({
        id: 'cpu-total',
        title: t('hostMetrics.cpuTotal'),
        series: [{ key: ckey('host.cpu.pct', 'host'), label: t('hostMetrics.cpuTotal'), kind: 'host.cpu.pct', target: 'host', unit: 'pct', color: kindColor('host.cpu.pct') }],
      })
    }
    const cores = g.metrics.filter((m) => m.kind === 'host.cpu.core.pct').sort((a, b) => coreNum(a.target) - coreNum(b.target))
    if (cores.length) {
      charts.push({
        id: 'cpu-cores',
        title: t('hostMetrics.cpuCores'),
        series: cores.map((c, i) => ({ key: ckey('host.cpu.core.pct', c.target), label: coreLabel(c.target), kind: 'host.cpu.core.pct', target: c.target, unit: 'pct', color: FALLBACK[i % FALLBACK.length] })),
      })
    }
    return charts
  }
  if (g.collection === 'iface') {
    // Every interface shares this one section, each as its own state-timeline
    // band (a lone bool metric renders as a status band in MetricChart).
    const ifaces = [...new Set(g.metrics.filter((m) => m.kind === 'iface.up').map((m) => m.target))].sort()
    return ifaces.map((name) => ({
      id: `iface-${name}`,
      title: name,
      status: true,
      series: [{ key: ckey('iface.up', name), label: metricLabel('iface.up'), kind: 'iface.up', target: name, unit: 'bool', color: kindColor('iface.up') }],
    }))
  }
  if (g.collection === 'netio') {
    // One chart for the host's aggregate network throughput: download (rx) and
    // upload (tx) rates overlaid, both on the shared bps axis.
    const one = (kind: string, label: string): CollSeries => ({
      key: ckey(kind, 'host'),
      label,
      kind,
      target: 'host',
      unit: 'bps',
      color: kindColor(kind),
    })
    const series: CollSeries[] = []
    if (g.metrics.some((m) => m.kind === 'host.net.rx_bps')) series.push(one('host.net.rx_bps', t('dashboard.download')))
    if (g.metrics.some((m) => m.kind === 'host.net.tx_bps')) series.push(one('host.net.tx_bps', t('dashboard.upload')))
    return series.length ? [{ id: 'netio', title: t('hostMetrics.sysNetwork'), series }] : []
  }
  if (g.collection === 'wifi') {
    // One section for all wireless adapters, each keyed by interface name: a
    // connection state-band (wifi.up), then signal / quality / link-rate trends.
    const adapters = [...new Set(g.metrics.map((m) => m.target))].sort()
    const charts: CollChart[] = []
    for (const name of adapters) {
      const has = (kind: string) => g.metrics.some((m) => m.kind === kind && m.target === name)
      const one = (kind: string, unit: string): CollSeries => ({
        key: ckey(kind, name),
        label: metricLabel(kind),
        kind,
        target: name,
        unit,
        color: kindColor(kind),
      })
      if (has('wifi.up')) {
        charts.push({ id: `wifi-up-${name}`, title: `${name} · ${metricLabel('wifi.up')}`, status: true, series: [one('wifi.up', 'bool')] })
      }
      if (has('wifi.signal_dbm')) {
        charts.push({ id: `wifi-sig-${name}`, title: `${name} · ${metricLabel('wifi.signal_dbm')}`, series: [one('wifi.signal_dbm', 'dbm')] })
      }
      if (has('wifi.quality_pct')) {
        charts.push({ id: `wifi-qual-${name}`, title: `${name} · ${metricLabel('wifi.quality_pct')}`, series: [one('wifi.quality_pct', 'pct')] })
      }
      const rates: CollSeries[] = []
      if (has('wifi.link_rx_mbps')) rates.push(one('wifi.link_rx_mbps', 'mbps'))
      if (has('wifi.link_tx_mbps')) rates.push(one('wifi.link_tx_mbps', 'mbps'))
      if (rates.length) charts.push({ id: `wifi-rate-${name}`, title: `${name} · ${t('hostMetrics.wifiLinkRate')}`, series: rates })
    }
    return charts
  }
  const mounts = [...new Set(g.metrics.filter((m) => m.kind === 'host.disk.used').map((m) => m.target))].sort()
  return mounts.map((mp) => ({
    id: `disk-${mp}`,
    title: mp,
    series: [
      { key: ckey('host.disk.used', mp), label: t('hostMetrics.diskUsed'), kind: 'host.disk.used', target: mp, unit: 'bytes', color: kindColor('host.disk.used') },
      { key: ckey('host.disk.free', mp), label: t('hostMetrics.diskFree'), kind: 'host.disk.free', target: mp, unit: 'bytes', color: kindColor('host.disk.free') },
    ],
    hidden: [{ key: ckey('host.disk.total', mp), label: t('hostMetrics.diskTotal'), kind: 'host.disk.total', target: mp, unit: 'bytes', color: '' }],
    totalKey: ckey('host.disk.total', mp),
  }))
})

const collectionChartsData = computed(() =>
  collectionCharts.value.map((c) => {
    let caption = ''
    if (c.totalKey) {
      const ts = collSamples.value[c.totalKey]
      if (ts?.length) caption = t('hostMetrics.diskTotalCap', { size: fmtBytes(ts[ts.length - 1].value) })
    }
    return {
      id: c.id,
      title: c.title,
      caption,
      status: c.status ?? false,
      metrics: c.series.map((s) => ({ key: s.key, label: s.label, kind: s.kind, unit: s.unit, color: s.color, samples: collSamples.value[s.key] ?? [] })),
    }
  }),
)

const pickerMetrics = computed(() => (selectedGroup.value?.metrics ?? []).filter((m) => !INFO_KINDS.has(m.kind)))

const activeMetrics = computed(() => {
  const g = selectedGroup.value
  if (!g) return []
  return g.metrics
    .filter((m) => selectedKinds.value.includes(m.kind))
    .map((m) => ({
      key: m.kind,
      label: metricLabel(m.kind),
      kind: m.kind,
      unit: m.unit,
      color: kindColor(m.kind),
      samples: samplesByKind.value[m.kind] ?? [],
    }))
})

const chartTitle = computed(() => selectedGroup.value?.label ?? '')

const trendMetrics = computed(() =>
  activeMetrics.value.filter((m) => !isStatusKind(m.kind, m.unit) && !INFO_KINDS.has(m.kind)),
)
const statusMetrics = computed(() => activeMetrics.value.filter((m) => isStatusKind(m.kind, m.unit)))
const someData = (list: { samples: Sample[] }[]) => list.some((m) => m.samples.length)
const isUptimeMetric = (kind: string) => kind === 'agent.uptime_s'

const metricCards = computed(() => buildCards(activeMetrics.value))

function applyDefaultKinds() {
  const g = selectedGroup.value
  if (!g || g.collection) {
    selectedKinds.value = []
    return
  }
  const numeric = g.metrics.filter((m) => m.unit !== 'bool').map((m) => m.kind)
  selectedKinds.value = numeric.length ? numeric : g.metrics.map((m) => m.kind)
}

function toggleKind(k: string) {
  const set = new Set(selectedKinds.value)
  if (set.has(k)) {
    if (set.size === 1) return
    set.delete(k)
  } else set.add(k)
  selectedKinds.value = selectedGroup.value!.metrics.filter((m) => set.has(m.kind)).map((m) => m.kind)
  loadData()
}

function selectSection(key: string) {
  if (targetKey.value === key) return
  targetKey.value = key
  applyDefaultKinds()
  loadData()
  loadAlerts()
}

async function loadAgents() {
  try {
    agents.value = await api.agents()
    const requestedAgent = String(route.query.agent || '')
    if (requestedAgent && agents.value.some((agent) => agent.id === requestedAgent)) agentId.value = requestedAgent
    else if (!agentId.value && agents.value.length) agentId.value = agents.value[0].id
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}

async function loadSeries() {
  if (!agentId.value) return
  try {
    const ser = await api.listSeries(agentId.value)
    // Host Metrics owns the host's own hardware: host.* metrics, the network
    // interfaces (iface.*), and the agent uptime counter. Probe results (the
    // user-created monitors) belong to the Target Status page.
    series.value = ser.filter(
      (s) =>
        !HIDDEN_KINDS.has(s.kind) &&
        (familyOf(s.kind) === 'host' || familyOf(s.kind) === 'iface' || familyOf(s.kind) === 'wifi' || s.kind === 'agent.uptime_s'),
    )
    const gs = groups.value
    targetKey.value = gs.length ? gs[0].key : ''
    applyDefaultKinds()
    await Promise.all([loadData(), loadAlerts()])
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}

async function loadAlerts() {
  const seq = ++alertSeq
  const g = selectedGroup.value
  if (!agentId.value || !g) {
    alerts.value = []
    return
  }
  try {
    // Alerts are target-scoped. Whole-machine rules (CPU / memory / load) fire on
    // the "host" target, so the CPU collection and the overview both read "host"
    // alerts; disk rules fire per mount, so the disk collection merges each
    // mount's alerts. (CPU cores and the agent-runtime series carry no rules.)
    let res: Alert[]
    if (g.collection === 'disk') {
      const mounts = [...new Set(g.metrics.map((m) => m.target))]
      const lists = await Promise.all(
        mounts.map((mp) => api.agentAlerts(agentId.value, { target: mp }, 10).catch(() => [] as Alert[])),
      )
      res = lists
        .flat()
        .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
        .slice(0, 10)
    } else {
      res = await api.agentAlerts(agentId.value, { target: g.collection === 'cpu' ? 'host' : g.target }, 10)
    }
    if (seq === alertSeq) alerts.value = res
  } catch {
    if (seq === alertSeq) alerts.value = []
  }
}

async function loadData() {
  const seq = ++dataSeq
  const g = selectedGroup.value
  if (!agentId.value || !g) {
    samplesByKind.value = {}
    collSamples.value = {}
    return
  }
  if (g.collection) return loadCollection(seq)
  const kinds = selectedKinds.value.slice()
  if (!kinds.length) {
    samplesByKind.value = {}
    return
  }
  loading.value = true
  try {
    const results = await Promise.all(
      kinds.map((k) => api.metrics(agentId.value, k, { target: g.target || undefined, limit: 5000, sinceSeconds: rangeSec.value })),
    )
    if (seq !== dataSeq) return
    const map: Record<string, Sample[]> = {}
    kinds.forEach((k, i) => (map[k] = results[i]))
    samplesByKind.value = map
    error.value = ''
  } catch (e) {
    if (seq === dataSeq) error.value = String((e as Error).message || e)
  } finally {
    if (seq === dataSeq) loading.value = false
  }
}

async function loadCollection(seq: number) {
  const pairs = collectionCharts.value.flatMap((c) => [...c.series, ...(c.hidden ?? [])])
  if (!pairs.length) {
    collSamples.value = {}
    return
  }
  loading.value = true
  try {
    const results = await Promise.all(
      pairs.map((p) => api.metrics(agentId.value, p.kind, { target: p.target || undefined, limit: 5000, sinceSeconds: rangeSec.value })),
    )
    if (seq !== dataSeq) return
    const map: Record<string, Sample[]> = {}
    pairs.forEach((p, i) => (map[p.key] = results[i]))
    collSamples.value = map
    error.value = ''
  } catch (e) {
    if (seq === dataSeq) error.value = String((e as Error).message || e)
  } finally {
    if (seq === dataSeq) loading.value = false
  }
}

function onAgentChange() {
  series.value = []
  loadSeries()
}

onMounted(async () => {
  await loadAgents()
  await loadSeries()
})
</script>

<template>
  <main class="page">
    <div class="page-head">
      <h2>{{ t('hostMetrics.title') }}</h2>
      <p class="sub">{{ t('hostMetrics.sub') }}</p>
    </div>

    <p v-if="error" class="err">{{ error }}</p>

    <div v-if="!agents.length" class="card empty">
      <h3>{{ t('common.noAgents') }}</h3>
      <p class="hint">{{ t('hostMetrics.noAgentHint') }}</p>
    </div>

    <template v-else>
      <div class="card toolbar">
        <label class="fg">
          <span>Agent</span>
          <select v-model="agentId" @change="onAgentChange">
            <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.hostname || a.id }} ({{ a.platform }})</option>
          </select>
        </label>

        <div class="fg grow" v-if="groups.length">
          <span>{{ t('hostMetrics.sectionLabel') }}</span>
          <div class="segmented">
            <button v-for="g in groups" :key="g.key" :class="{ active: targetKey === g.key }" @click="selectSection(g.key)">
              {{ g.label }}
            </button>
          </div>
        </div>

        <div class="fg">
          <span>{{ t('metrics.timeRange') }}</span>
          <RangePicker v-model="rangeSec" @change="loadData" />
        </div>

        <button class="btn refresh" @click="loadData">{{ t('common.refresh') }}</button>
      </div>

      <p v-if="!groups.length" class="hint pad">{{ t('hostMetrics.noSeries') }}</p>

      <template v-else>
        <template v-if="selectedGroup && selectedGroup.collection">
          <div class="card chart-card" v-for="c in collectionChartsData" :key="c.id">
            <p v-if="c.caption" class="chart-caption">{{ c.caption }}</p>
            <MetricChart :title="c.title" :metrics="c.metrics" />
            <div v-if="c.status" class="legend">
              <span><i class="dot on"></i>{{ t('chart.normalEnabled') }}</span>
              <span><i class="dot off"></i>{{ t('chart.interruptedDisabled') }}</span>
            </div>
            <p v-if="!loading && !someData(c.metrics)" class="empty-line hint">{{ t('metrics.noDataRange') }}</p>
          </div>
        </template>

        <template v-else>
          <div class="fg metric-picker" v-if="pickerMetrics.length > 1">
            <span>{{ t('metrics.metricPicker') }}</span>
            <div class="chips">
              <button
                v-for="m in pickerMetrics"
                :key="m.kind"
                class="chip"
                :class="{ active: selectedKinds.includes(m.kind) }"
                :style="{ '--c': kindColor(m.kind) }"
                @click="toggleKind(m.kind)"
              >
                <i class="cdot" :style="{ background: kindColor(m.kind) }"></i>{{ metricLabel(m.kind) }}
              </button>
            </div>
          </div>

          <MetricStatCards :cards="metricCards" />

          <div class="card chart-card" v-if="trendMetrics.length">
            <MetricChart :title="chartTitle" :metrics="trendMetrics" />
            <p v-if="!loading && !someData(trendMetrics)" class="empty-line hint">{{ t('metrics.noDataRange') }}</p>
          </div>

          <div class="card chart-card" v-for="m in statusMetrics" :key="m.key">
            <MetricChart :title="`${chartTitle} · ${m.label}`" :metrics="[m]" />
            <div class="legend">
              <span><i class="dot on"></i>{{ isUptimeMetric(m.kind) ? t('chart.online') : t('chart.normalEnabled') }}</span>
              <span><i class="dot off"></i>{{ isUptimeMetric(m.kind) ? t('chart.offlineFault') : t('chart.interruptedDisabled') }}</span>
              <span v-if="isUptimeMetric(m.kind)"><i class="dot mark"></i>{{ t('chart.restart') }}</span>
            </div>
            <p v-if="!loading && !m.samples.length" class="empty-line hint">{{ t('metrics.noDataRange') }}</p>
          </div>
        </template>

        <AlertsTable :alerts="alerts" />
      </template>
    </template>
  </main>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: flex-end;
  gap: 16px;
  flex-wrap: wrap;
  padding: 16px 18px;
  margin-bottom: 20px;
}
.fg {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.fg > span {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}
.fg.grow {
  flex: 1;
  min-width: 220px;
}
.metric-picker {
  margin-bottom: 16px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 12px;
  border-radius: 7px;
  border: 1px solid var(--border-strong);
  background: var(--input-bg);
  color: var(--text-dim);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}
.chip:hover {
  color: var(--text);
}
.chip.active {
  color: var(--text);
  border-color: var(--c);
  background: var(--surface-2);
}
.cdot {
  width: 9px;
  height: 9px;
  border-radius: 3px;
  opacity: 0.45;
}
.chip.active .cdot {
  opacity: 1;
}
.segmented {
  display: inline-flex;
  padding: 3px;
  gap: 2px;
  background: var(--input-bg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  flex-wrap: wrap;
}
.segmented button {
  border: none;
  background: transparent;
  color: var(--text-dim);
  font: inherit;
  font-size: 13px;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
}
.segmented button:hover {
  color: var(--text);
}
.segmented button.active {
  color: #04121c;
  background: linear-gradient(180deg, #59c7fb, var(--primary-strong));
  font-weight: 600;
}
.refresh {
  margin-left: auto;
}
.chart-card {
  position: relative;
  padding: 10px 8px 6px;
}
.chart-caption {
  margin: 2px 12px 0;
  text-align: right;
  font-size: 12px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.legend {
  display: flex;
  gap: 18px;
  padding: 4px 14px 8px;
  font-size: 12px;
  color: var(--text-dim);
}
.legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.legend .dot {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  display: inline-block;
}
.legend .dot.on {
  background: #34d399;
}
.legend .dot.off {
  background: #f87171;
}
.legend .dot.mark {
  background: #fbbf24;
}
.empty-line {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
}
.empty {
  text-align: center;
  padding: 48px 20px;
}
.pad {
  padding: 8px 2px;
}
</style>
