<script setup lang="ts">
// By-target comparison: the same monitoring target as seen from several agents.
// The summary table's current state comes from the authoritative target-status
// batch (per-agent execution/probe/fault) and its 24h/7d/30d availability from the
// server's own verdict-round accounting; the range availability/outages/latest
// columns, trend charts, per-agent status bands and NAT/TCP cards stay
// metric-based (historical), overlaying one line/row per agent.
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  api,
  type AvailabilityWindow,
  type FaultSignal,
  type KindSummary,
  type Sample,
  type TargetAgentStatusRow,
} from '../../api'
import MetricChart from '../MetricChart.vue'
import StatusBand from '../StatusBand.vue'
import MetricStatCards from '../MetricStatCards.vue'
import FaultSignalsTable from '../FaultSignalsTable.vue'
import MonitorStateBadge from './MonitorStateBadge.vue'
import { useMetricMeta } from '../../composables/useMetricMeta'
import { useMetricCards, type Card } from '../../composables/useMetricCards'
import {
  FALLBACK,
  CODE_KINDS,
  INFO_KINDS,
  SUMMARY_MAX_SEC,
  isStatusKind,
  kindColor,
  orderOf,
} from '../../lib/metricMeta'
import { bandSeriesFor, type Prober } from '../../lib/targetGroups'
import { availability, toPoints } from '../../lib/timeline'
import { availabilityTone, formatAvailability, type Tone } from '../../lib/targetStatus'
import { targetIndex } from '../../targetStatus'
import { fmtByUnit, isByteUnit } from '../../lib/format'
import { agentLabel } from '../../lib/agentLabel'

const props = defineProps<{
  family: string
  familyLabel: string
  target: string
  monitorId?: string // set for user-created monitors; monitor-less system series have none
  name?: string // the monitor's display name
  probers: Prober[]
  rangeSec: number
  restrictToProbers?: boolean
}>()

const { t } = useI18n()
const { metricLabel, unitLabel } = useMetricMeta()
const { buildCard, buildCodeCard } = useMetricCards()

// The fixed windows the server reports availability over, shown per Agent beside
// the range-scoped historical figure.
const AVAIL_WINDOWS: AvailabilityWindow[] = ['24h', '7d', '30d']

const samples = ref<Record<string, Sample[]>>({}) // key: `${agentId}::${kind}`
// Server-side aggregates for categorical code kinds (NAT / TCP error): the
// cards only need latest (+ determinate fallback), so these come from the
// summary endpoint instead of a raw sample window. key: `${agentId}::${kind}`.
const summaries = ref<Record<string, KindSummary>>({})
const faults = ref<FaultSignal[]>([])
// window -> agent id -> success ratio. A missing entry is "unknown", never 0%.
const availWindows = ref<Record<string, Map<string, number>>>({})
const loading = ref(false)
let dataSeq = 0
let faultSeq = 0
let availSeq = 0

const skey = (agentId: string, kind: string) => `${agentId}::${kind}`

// Authoritative current status for this target across agents (batch).
const storeRow = computed(() => (props.monitorId ? targetIndex.value.get(props.monitorId) : undefined))

// Unit for each kind, taken from whichever prober records it.
const kindUnit = computed(() => {
  const m = new Map<string, string>()
  for (const p of props.probers) for (const s of p.series) if (!m.has(s.kind)) m.set(s.kind, s.unit)
  return m
})

const allKinds = computed(() => [...kindUnit.value.keys()].sort((a, b) => orderOf(a) - orderOf(b)))
const numericKinds = computed(() => allKinds.value.filter((k) => kindUnit.value.get(k) !== 'bool' && !INFO_KINDS.has(k)))
const statusKinds = computed(() => allKinds.value.filter((k) => isStatusKind(k, kindUnit.value.get(k) || '')))
// Card-only kinds shown as per-agent stat cards (categorical NAT + TCP error
// codes, and the ICMP sample count).
const cardKinds = computed(() => allKinds.value.filter((k) => INFO_KINDS.has(k)))

const selectedNumeric = ref<string[]>([])

// The historical band series used for the summary's availability/outages.
const band = computed(() => bandSeriesFor(props.family))
// The headline numeric shown as "latest" in the summary (RTT / resolve / latency).
const primaryNumeric = computed(() => numericKinds.value[0] ?? '')

// Categorical code kinds render as latest-value cards only — they're served by
// the aggregation endpoint, never fetched as sample windows.
const codeKinds = computed(() => cardKinds.value.filter((k) => CODE_KINDS.has(k)))

// Every kind we need to fetch per agent as a sample series: selected charts +
// status bands + non-code card kinds + the summary's band source + the headline
// numeric. Code kinds are excluded — see codeKinds.
const fetchKinds = computed(() => {
  const set = new Set<string>([...selectedNumeric.value, ...statusKinds.value, ...cardKinds.value])
  for (const k of CODE_KINDS) set.delete(k)
  if (band.value) set.add(band.value.kind)
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
    label: agentLabel(p.agent),
    kind,
    unit: kindUnit.value.get(kind) || '',
    color: FALLBACK[i % FALLBACK.length],
    samples: samplesFor(p.agent.id, kind),
  }))
}
const chartHasData = (kind: string) => props.probers.some((p) => samplesFor(p.agent.id, kind).length)

// Availability% → tone (historical, threshold-based; never current inference).
function availTone(pct: number | null): 'good' | 'bad' | 'warn' | 'unknown' {
  if (pct === null) return 'unknown'
  return pct >= 99 ? 'good' : pct >= 95 ? 'warn' : 'bad'
}

// One stacked row per agent for a boolean status kind.
function statusRows(kind: string) {
  const b = band.value
  const toUp = b && b.kind === kind ? b.toUp : (v: number) => (v >= 0.5 ? 1 : 0)
  const now = Date.now()
  return props.probers.map((p) => {
    const raw = samplesFor(p.agent.id, kind)
    const pts = toPoints(raw).map((x) => ({ t: x.t, v: toUp(x.v) }))
    const avail = pts.length ? availability(pts, now) * 100 : null
    return {
      agent: agentLabel(p.agent),
      id: p.agent.id,
      samples: raw,
      toUp,
      tone: availTone(avail),
      avail: avail === null ? null : avail.toFixed(1),
    }
  })
}

// Per-agent stat card for a card-only kind. Categorical code kinds (NAT/TCP
// error) build from the server-side aggregate; the numeric ICMP sample count
// keeps the sample-based card (its foot shows min/max/avg over the range).
function agentCards(kind: string): { agent: string; card: Card }[] {
  return props.probers
    .filter((p) => p.series.some((s) => s.kind === kind))
    .map((p) => ({
      agent: agentLabel(p.agent),
      card: CODE_KINDS.has(kind)
        ? buildCodeCard({ label: metricLabel(kind), color: kindColor(kind), kind }, summaries.value[skey(p.agent.id, kind)])
        : buildCard({ label: metricLabel(kind), color: kindColor(kind), kind, unit: kindUnit.value.get(kind) || 'code', samples: samplesFor(p.agent.id, kind) }),
    }))
}

interface SummaryRow {
  id: string
  agent: string
  online: boolean
  row?: TargetAgentStatusRow // authoritative current state
  availTone: 'good' | 'bad' | 'warn' | 'unknown'
  avail: string | null
  outages: number
  latest: string
}
// The agent set is the batch's applicable agents (so blocked/pending/offline
// agents appear even without series); monitor-less system series fall back to the
// probers that record data.
const summary = computed<SummaryRow[]>(() => {
  const now = Date.now()
  const b = band.value
  const pn = primaryNumeric.value
  const pnUnit = pn ? kindUnit.value.get(pn) || '' : ''
  const allowedAgents = new Set(props.probers.map((p) => p.agent.id))
  const currentAgents = props.restrictToProbers
    ? storeRow.value?.agents.filter((agent) => allowedAgents.has(agent.agent_id))
    : storeRow.value?.agents
  const rows = currentAgents?.map((a) => ({ id: a.agent_id, agent: a.agent_name || a.agent_id, online: a.agent_online, row: a as TargetAgentStatusRow | undefined }))
    ?? props.probers.map((p) => ({ id: p.agent.id, agent: agentLabel(p.agent), online: p.agent.status === 'online', row: undefined }))
  return rows.map((base) => {
    let avail: number | null = null
    let outages = 0
    if (b) {
      const pts = toPoints(samplesFor(base.id, b.kind)).map((x) => ({ t: x.t, v: b.toUp(x.v) }))
      if (pts.length) {
        avail = availability(pts, now) * 100
        for (let i = 1; i < pts.length; i++) if (pts[i - 1].v >= 0.5 && pts[i].v < 0.5) outages++
      }
    }
    let latest = '—'
    if (pn) {
      const s = samplesFor(base.id, pn)
      if (s.length) {
        const v = s[s.length - 1].value
        latest = isByteUnit(pnUnit) ? fmtByUnit(pnUnit, v) : `${Number.isInteger(v) ? v : v.toFixed(1)}${unitLabel(pnUnit) ? ' ' + unitLabel(pnUnit) : ''}`
      }
    }
    return {
      id: base.id,
      agent: base.agent,
      online: base.online,
      row: base.row,
      availTone: availTone(avail),
      avail: avail === null ? null : avail.toFixed(1),
      outages,
      latest,
    }
  })
})

async function loadData() {
  const seq = ++dataSeq
  const kinds = fetchKinds.value
  const codes = codeKinds.value
  if (!props.probers.length || (!kinds.length && !codes.length)) {
    samples.value = {}
    summaries.value = {}
    return
  }
  loading.value = true
  const scope = {
    monitor: props.monitorId,
    target: props.monitorId ? undefined : props.target || undefined,
  }
  const jobs: Promise<[string, Sample[]]>[] = []
  for (const p of props.probers) {
    for (const k of kinds) {
      jobs.push(
        api
          .metrics(p.agent.id, k, { ...scope, limit: 5000, sinceSeconds: props.rangeSec })
          .then((s) => [skey(p.agent.id, k), s] as [string, Sample[]])
          .catch(() => [skey(p.agent.id, k), []] as [string, Sample[]]),
      )
    }
  }
  // One aggregate request per agent covers all code kinds. The window follows
  // the selected range (clamped to the endpoint's raw-retention cap) so a card
  // never shows a result from outside the range the user is looking at.
  const summaryJobs: Promise<[string, Record<string, KindSummary>]>[] = codes.length
    ? props.probers.map((p) =>
        api
          .metricsSummary(p.agent.id, codes, { ...scope, sinceSeconds: Math.min(props.rangeSec, SUMMARY_MAX_SEC) })
          .then((s) => [p.agent.id, s.kinds] as [string, Record<string, KindSummary>])
          .catch(() => [p.agent.id, {}] as [string, Record<string, KindSummary>]),
      )
    : []
  const [results, summaryResults] = await Promise.all([Promise.all(jobs), Promise.all(summaryJobs)])
  if (seq !== dataSeq) return
  const map: Record<string, Sample[]> = {}
  for (const [k, s] of results) map[k] = s
  samples.value = map
  const sums: Record<string, KindSummary> = {}
  for (const [agentId, kindMap] of summaryResults) {
    for (const [k, ks] of Object.entries(kindMap)) sums[skey(agentId, k)] = ks
  }
  summaries.value = sums
  loading.value = false
}

// Confirmed fault history for this target, newest confirmation first. Signals are
// target-scoped (one request covers every Agent), and each row carries its own
// frozen evidence, so nothing here is re-derived from metric samples. A
// monitor-less system series has no target id to scope by and shows no records.
async function loadFaults() {
  const seq = ++faultSeq
  if (!props.monitorId) {
    faults.value = []
    return
  }
  try {
    const list = await api.faultSignals({ target: props.monitorId, limit: 20 })
    if (seq !== faultSeq) return
    faults.value = [...list].sort((a, b) => new Date(b.confirmed_at).getTime() - new Date(a.confirmed_at).getTime())
  } catch {
    if (seq === faultSeq) faults.value = []
  }
}

// Per-Agent availability over the server's fixed windows. Rounds that reached no
// verdict are absent from the denominator, and an Agent with no verdict at all in
// a window is simply missing here — rendered "unknown" rather than 0%.
async function loadAvailability() {
  const seq = ++availSeq
  if (!props.monitorId) {
    availWindows.value = {}
    return
  }
  try {
    const res = await api.targetAvailability(props.monitorId, AVAIL_WINDOWS)
    if (seq !== availSeq) return
    const out: Record<string, Map<string, number>> = {}
    for (const w of res.windows) {
      const byAgent = new Map<string, number>()
      for (const ratio of w.agents) if (ratio.agent_id) byAgent.set(ratio.agent_id, ratio.ratio)
      out[w.window] = byAgent
    }
    availWindows.value = out
  } catch {
    if (seq === availSeq) availWindows.value = {}
  }
}

const windowRatio = (agentId: string, window: AvailabilityWindow) => availWindows.value[window]?.get(agentId)
const windowAvail = (agentId: string, window: AvailabilityWindow): string =>
  formatAvailability(windowRatio(agentId, window)) ?? t('targetStatus.availabilityUnknown')
const windowTone = (agentId: string, window: AvailabilityWindow): Tone => availabilityTone(windowRatio(agentId, window))

function reload() {
  applyDefaults()
  loadData()
  loadFaults()
  loadAvailability()
}

watch([
  () => props.monitorId,
  () => props.target,
  () => props.probers.map((p) => p.agent.id).join(','),
], reload)
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
            <th class="num">{{ t('targetStatus.availability24h') }}</th>
            <th class="num">{{ t('targetStatus.availability7d') }}</th>
            <th class="num">{{ t('targetStatus.availability30d') }}</th>
            <th class="num">{{ t('targetStatus.thAvailability') }}</th>
            <th class="num">{{ t('targetStatus.thOutages') }}</th>
            <th class="num">{{ t('targetStatus.thLatest') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in summary" :key="r.id">
            <td class="mono">
              <span class="dot-inline" :class="r.online ? 'on' : 'off'"></span>{{ r.agent }}
            </td>
            <td>
              <span v-if="r.row" class="op-cell">
                <MonitorStateBadge dim="execution" :state="r.row.execution_state" />
                <MonitorStateBadge v-if="r.row.probe_state !== 'not_applicable'" dim="probe" :state="r.row.probe_state" />
                <MonitorStateBadge v-if="r.row.fault_state !== 'normal'" dim="fault" :state="r.row.fault_state" />
              </span>
              <span v-else class="hint">—</span>
            </td>
            <td
              v-for="w in AVAIL_WINDOWS"
              :key="w"
              class="num mono"
              :class="`t-${windowTone(r.id, w)}`"
            >{{ windowAvail(r.id, w) }}</td>
            <td class="num mono" :class="`t-${r.availTone}`">{{ r.avail === null ? '—' : r.avail + '%' }}</td>
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

    <!-- per-agent categorical / sample-count cards -->
    <template v-for="k in cardKinds" :key="k">
      <div class="nat-block">
        <h4>{{ metricLabel(k) }}</h4>
        <div class="nat-cards">
          <div class="nat-agent" v-for="nc in agentCards(k)" :key="nc.agent">
            <span class="na mono">{{ nc.agent }}</span>
            <MetricStatCards :cards="[nc.card]" />
          </div>
        </div>
      </div>
    </template>

    <!-- Confirmed fault history. Every column is frozen at confirmation time, so a
         later rename or deletion of the target cannot rewrite what it said. -->
    <FaultSignalsTable :signals="faults" show-agent />
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
.dot-inline {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
}
.dot-inline.on {
  background: var(--success);
}
.dot-inline.off {
  background: var(--border-strong);
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
  transition:
    color var(--dur-micro) var(--ease-out),
    background-color var(--dur-micro) var(--ease-out),
    border-color var(--dur-micro) var(--ease-out);
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
.t-warn {
  color: #fcd34d;
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
