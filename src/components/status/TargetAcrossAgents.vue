<script setup lang="ts">
// By-target comparison: the same monitoring target as seen from several agents.
// A summary table (current state / availability / outages / latest value per
// agent), one trend chart per numeric metric overlaying one line per agent, a
// stacked status band per boolean metric, per-agent NAT cards, and merged alarm
// history with an agent column.
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type Agent, type Alert, type Sample, type MonitorStatusRow } from '../../api'
import MetricChart from '../MetricChart.vue'
import StatusBand from '../StatusBand.vue'
import MetricStatCards from '../MetricStatCards.vue'
import AlertsTable from '../AlertsTable.vue'
import MonitorStateBadge, { type MonitorState } from './MonitorStateBadge.vue'
import { useMetricMeta } from '../../composables/useMetricMeta'
import { useMetricCards, type Card } from '../../composables/useMetricCards'
import {
  FALLBACK,
  INFO_KINDS,
  NAT_CODE_KINDS,
  isStatusKind,
  kindColor,
  orderOf,
  statusSource,
} from '../../lib/metricMeta'
import type { Prober } from '../../lib/targetGroups'
import { availability, boolCurrent, toPoints } from '../../lib/timeline'
import { fmtByUnit, isByteUnit } from '../../lib/format'

const props = defineProps<{
  family: string
  familyLabel: string
  target: string
  monitorId?: string // set for user-created monitors; monitor-less system series have none
  name?: string // the monitor's display name
  probers: Prober[]
  // Non-active operational status per agent id (permission/target/unsupported) and
  // the ids of offline agents, so the summary composes a blocked or offline agent
  // distinctly from an actually-failing one.
  opStatus?: Record<string, MonitorStatusRow>
  offlineIds?: string[]
  rangeSec: number
}>()

const { t } = useI18n()
const { metricLabel, unitLabel } = useMetricMeta()
const { buildCard } = useMetricCards()

const samples = ref<Record<string, Sample[]>>({}) // key: `${agentId}::${kind}`
const alerts = ref<Alert[]>([])
const loading = ref(false)
let dataSeq = 0
let alertSeq = 0

const skey = (agentId: string, kind: string) => `${agentId}::${kind}`
const agentName = (a: Agent) => a.display_name || a.hostname || a.id

// Unit for each kind, taken from whichever prober records it.
const kindUnit = computed(() => {
  const m = new Map<string, string>()
  for (const p of props.probers) for (const s of p.series) if (!m.has(s.kind)) m.set(s.kind, s.unit)
  return m
})

const allKinds = computed(() => [...kindUnit.value.keys()].sort((a, b) => orderOf(a) - orderOf(b)))
const numericKinds = computed(() => allKinds.value.filter((k) => kindUnit.value.get(k) !== 'bool' && !INFO_KINDS.has(k)))
const statusKinds = computed(() => allKinds.value.filter((k) => isStatusKind(k, kindUnit.value.get(k) || '')))
const natKinds = computed(() => allKinds.value.filter((k) => NAT_CODE_KINDS.has(k)))

const selectedNumeric = ref<string[]>([])

// The status series used for the summary table's up/down + availability.
const source = computed(() => statusSource(props.family))
// The headline numeric shown as "latest" in the summary (RTT / resolve / latency).
const primaryNumeric = computed(() => numericKinds.value[0] ?? '')

// Every kind we need to fetch per agent: selected charts + status bands + NAT
// cards + the summary's status source + the headline numeric.
const fetchKinds = computed(() => {
  const set = new Set<string>([...selectedNumeric.value, ...statusKinds.value, ...natKinds.value])
  if (source.value) set.add(source.value.kind)
  if (primaryNumeric.value) set.add(primaryNumeric.value)
  return [...set]
})

function applyDefaults() {
  selectedNumeric.value = numericKinds.value.slice()
}

function toggleNumeric(k: string) {
  const set = new Set(selectedNumeric.value)
  if (set.has(k)) set.delete(k)
  else set.add(k)
  selectedNumeric.value = numericKinds.value.filter((x) => set.has(x))
  loadData()
}

const samplesFor = (agentId: string, kind: string) => samples.value[skey(agentId, kind)] ?? []

// One overlaid line per agent for a given kind.
function chartMetrics(kind: string) {
  return props.probers.map((p, i) => ({
    key: p.agent.id,
    label: agentName(p.agent),
    kind,
    unit: kindUnit.value.get(kind) || '',
    color: FALLBACK[i % FALLBACK.length],
    samples: samplesFor(p.agent.id, kind),
  }))
}
const chartHasData = (kind: string) => props.probers.some((p) => samplesFor(p.agent.id, kind).length)

// One stacked row per agent for a boolean status kind.
function statusRows(kind: string) {
  const src = statusSource(props.family)
  const toUp = src && src.kind === kind ? src.toUp : (v: number) => (v >= 0.5 ? 1 : 0)
  const now = Date.now()
  return props.probers.map((p) => {
    const raw = samplesFor(p.agent.id, kind)
    const pts = toPoints(raw).map((x) => ({ t: x.t, v: toUp(x.v) }))
    const cur = pts.length ? boolCurrent(pts, now) : null
    return {
      agent: agentName(p.agent),
      id: p.agent.id,
      samples: raw,
      toUp,
      tone: cur === null ? 'unknown' : cur ? 'good' : 'bad',
      avail: pts.length ? (availability(pts, now) * 100).toFixed(1) : null,
    }
  })
}

// Per-agent NAT categorical card for a NAT code kind.
function natCards(kind: string): { agent: string; card: Card }[] {
  return props.probers
    .filter((p) => p.series.some((s) => s.kind === kind))
    .map((p) => ({
      agent: agentName(p.agent),
      card: buildCard({ label: metricLabel(kind), color: kindColor(kind), kind, unit: kindUnit.value.get(kind) || 'code', samples: samplesFor(p.agent.id, kind) }),
    }))
}

interface SummaryRow {
  id: string
  agent: string
  tone: 'good' | 'bad' | 'unknown'
  status: string
  avail: string | null
  outages: number
  latest: string
  block: MonitorState | null // non-active operational block (overrides the metric pill)
  offline: boolean
}
const summary = computed<SummaryRow[]>(() => {
  const now = Date.now()
  const src = source.value
  const pn = primaryNumeric.value
  const pnUnit = pn ? kindUnit.value.get(pn) || '' : ''
  const offline = new Set(props.offlineIds ?? [])
  return props.probers.map((p) => {
    let tone: 'good' | 'bad' | 'unknown' = 'unknown'
    let status = t('targetStatus.statusUnknown')
    let avail: string | null = null
    let outages = 0
    if (src) {
      const pts = toPoints(samplesFor(p.agent.id, src.kind)).map((x) => ({ t: x.t, v: src.toUp(x.v) }))
      if (pts.length) {
        const cur = boolCurrent(pts, now)
        tone = cur === null ? 'unknown' : cur ? 'good' : 'bad'
        status = cur === null ? t('targetStatus.statusUnknown') : cur ? t('targetStatus.statusNormal') : t('targetStatus.statusInterrupted')
        avail = (availability(pts, now) * 100).toFixed(1)
        for (let i = 1; i < pts.length; i++) if (pts[i - 1].v >= 0.5 && pts[i].v < 0.5) outages++
      }
    }
    let latest = '—'
    if (pn) {
      const s = samplesFor(p.agent.id, pn)
      if (s.length) {
        const v = s[s.length - 1].value
        latest = isByteUnit(pnUnit) ? fmtByUnit(pnUnit, v) : `${Number.isInteger(v) ? v : v.toFixed(1)}${unitLabel(pnUnit) ? ' ' + unitLabel(pnUnit) : ''}`
      }
    }
    const blockRow = props.opStatus?.[p.agent.id]
    const block = blockRow && blockRow.status !== 'active' ? (blockRow.status as MonitorState) : null
    return { id: p.agent.id, agent: agentName(p.agent), tone, status, avail, outages, latest, block, offline: offline.has(p.agent.id) }
  })
})

async function loadData() {
  const seq = ++dataSeq
  const kinds = fetchKinds.value
  if (!props.probers.length || !kinds.length) {
    samples.value = {}
    return
  }
  loading.value = true
  const jobs: Promise<[string, Sample[]]>[] = []
  for (const p of props.probers) {
    for (const k of kinds) {
      jobs.push(
        api
          .metrics(p.agent.id, k, {
            monitor: props.monitorId,
            target: props.monitorId ? undefined : props.target || undefined,
            limit: 5000,
            sinceSeconds: props.rangeSec,
          })
          .then((s) => [skey(p.agent.id, k), s] as [string, Sample[]])
          .catch(() => [skey(p.agent.id, k), []] as [string, Sample[]]),
      )
    }
  }
  const results = await Promise.all(jobs)
  if (seq !== dataSeq) return
  const map: Record<string, Sample[]> = {}
  for (const [k, s] of results) map[k] = s
  samples.value = map
  loading.value = false
}

async function loadAlerts() {
  const seq = ++alertSeq
  const scope = props.monitorId ? { monitor: props.monitorId } : { target: props.target }
  try {
    const lists = await Promise.all(props.probers.map((p) => api.agentAlerts(p.agent.id, scope, 10).catch(() => [] as Alert[])))
    if (seq !== alertSeq) return
    alerts.value = lists
      .flat()
      .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
      .slice(0, 20)
  } catch {
    if (seq === alertSeq) alerts.value = []
  }
}

function reload() {
  applyDefaults()
  loadData()
  loadAlerts()
}

watch(() => [props.monitorId, props.target, props.probers.map((p) => p.agent.id).join(',')], reload)
watch(() => props.rangeSec, loadData)
onMounted(reload)
</script>

<template>
  <div class="across">
    <p class="probed hint">{{ t('targetStatus.probedBy', { n: probers.length }) }}</p>

    <!-- summary table -->
    <div class="card summary">
      <table>
        <thead>
          <tr>
            <th>{{ t('targetStatus.thAgent') }}</th>
            <th>{{ t('targetStatus.thCurrent') }}</th>
            <th class="num">{{ t('targetStatus.thAvailability') }}</th>
            <th class="num">{{ t('targetStatus.thOutages') }}</th>
            <th class="num">{{ t('targetStatus.thLatest') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in summary" :key="r.id">
            <td class="mono">{{ r.agent }}</td>
            <td>
              <MonitorStateBadge v-if="r.block" :state="r.block" :offline="r.offline" />
              <span v-else class="op-cell">
                <span class="pill" :class="`is-${r.tone}`">{{ r.status }}</span>
                <span v-if="r.offline" class="pill is-unknown offline">{{ t('monitorState.agent_offline') }}</span>
              </span>
            </td>
            <td class="num mono">{{ r.avail === null ? '—' : r.avail + '%' }}</td>
            <td class="num mono">{{ r.avail === null ? '—' : r.outages }}</td>
            <td class="num mono">{{ r.latest }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- numeric metric picker -->
    <div class="fg metric-picker" v-if="numericKinds.length > 1">
      <span>{{ t('metrics.metricPicker') }}</span>
      <div class="chips">
        <button
          v-for="k in numericKinds"
          :key="k"
          class="chip"
          :class="{ active: selectedNumeric.includes(k) }"
          :style="{ '--c': kindColor(k) }"
          @click="toggleNumeric(k)"
        >
          <i class="cdot" :style="{ background: kindColor(k) }"></i>{{ metricLabel(k) }}
        </button>
      </div>
    </div>

    <!-- one trend chart per selected numeric kind, one line per agent -->
    <div class="card chart-card" v-for="k in numericKinds.filter((x) => selectedNumeric.includes(x))" :key="k">
      <MetricChart :title="`${familyLabel} · ${metricLabel(k)}`" :metrics="chartMetrics(k)" />
      <p v-if="!loading && !chartHasData(k)" class="empty-line hint">{{ t('metrics.noDataRange') }}</p>
    </div>

    <!-- per-agent status bands for each boolean metric -->
    <div class="card band-card" v-for="k in statusKinds" :key="k">
      <h4>{{ metricLabel(k) }}</h4>
      <div class="band-row" v-for="row in statusRows(k)" :key="row.id">
        <span class="ba mono">{{ row.agent }}</span>
        <StatusBand class="bb" :samples="row.samples" :to-up="row.toUp" />
        <span class="bc mono" :class="`t-${row.tone}`">{{ row.avail === null ? '—' : row.avail + '%' }}</span>
      </div>
    </div>

    <!-- per-agent NAT categorical cards -->
    <template v-for="k in natKinds" :key="k">
      <div class="nat-block">
        <h4>{{ metricLabel(k) }}</h4>
        <div class="nat-cards">
          <div class="nat-agent" v-for="nc in natCards(k)" :key="nc.agent">
            <span class="na mono">{{ nc.agent }}</span>
            <MetricStatCards :cards="[nc.card]" />
          </div>
        </div>
      </div>
    </template>

    <AlertsTable :alerts="alerts" show-agent />
  </div>
</template>

<style scoped>
.probed {
  margin: 0 0 12px;
  font-size: 13px;
}
.summary {
  padding: 6px 8px;
  margin-bottom: 18px;
}
.summary table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.summary th,
.summary td {
  text-align: left;
  padding: 9px 10px;
  border-bottom: 1px solid var(--border);
}
.summary tbody tr:last-child td {
  border-bottom: none;
}
.summary th {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  font-weight: 600;
}
.summary .num {
  text-align: right;
}
.mono {
  font-variant-numeric: tabular-nums;
}
.pill {
  font-size: 12px;
  padding: 2px 9px;
  border-radius: 999px;
  border: 1px solid transparent;
}
.pill.is-good {
  color: #6ee7b7;
  border-color: rgba(52, 211, 153, 0.4);
  background: rgba(52, 211, 153, 0.1);
}
.pill.is-bad {
  color: #fca5a5;
  border-color: rgba(248, 113, 113, 0.4);
  background: rgba(248, 113, 113, 0.1);
}
.pill.is-unknown {
  color: var(--text-dim);
  border-color: var(--border-strong);
}
.pill.offline {
  border-style: dashed;
}
.op-cell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.metric-picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
}
.metric-picker > span {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
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
.chart-card {
  position: relative;
  padding: 10px 8px 6px;
}
.empty-line {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
}
.band-card {
  padding: 14px 16px;
}
.band-card h4 {
  margin: 0 0 12px;
  font-size: 14px;
}
.band-row {
  display: grid;
  grid-template-columns: 160px 1fr 60px;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
.band-row:last-child {
  margin-bottom: 0;
}
.ba {
  font-size: 13px;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bc {
  text-align: right;
  font-size: 12px;
}
.t-good {
  color: #6ee7b7;
}
.t-bad {
  color: #fca5a5;
}
.t-unknown {
  color: var(--text-dim);
}
.nat-block {
  margin-bottom: 18px;
}
.nat-block h4 {
  margin: 0 0 10px;
  font-size: 14px;
}
.nat-cards {
  display: grid;
  gap: 10px;
}
.nat-agent {
  display: grid;
  gap: 4px;
}
.na {
  font-size: 12px;
  color: var(--text-muted);
}
</style>
