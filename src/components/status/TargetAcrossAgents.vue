<script setup lang="ts">
// By-target comparison: the same monitoring target as seen from several agents.
// The summary table's current state comes from the authoritative target-status
// batch (per-agent execution/probe/fault). Availability, outages, latest values,
// trend charts, per-agent status bands and NAT/TCP cards all use the page range,
// overlaying one line/row per agent.
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  api,
  type FaultSignal,
  type Fluctuation,
  type KindSummary,
  type Sample,
  type TargetAgentStatusRow,
  type TargetBaseline,
} from '../../api'
import MetricChart from '../MetricChart.vue'
import MetricStatCards from '../MetricStatCards.vue'
import StatusBand from '../StatusBand.vue'
import FaultSignalsTable from '../FaultSignalsTable.vue'
import FluctuationsTable from '../FluctuationsTable.vue'
import MonitorStateBadge from './MonitorStateBadge.vue'
import { useMetricMeta } from '../../composables/useMetricMeta'
import { useMetricCards, type Card } from '../../composables/useMetricCards'
import {
  FALLBACK,
  INFO_KINDS,
  LATEST_ONLY_KINDS,
  SUMMARY_MAX_SEC,
  defaultNumericKinds,
  isStatusKind,
  kindColor,
  orderOf,
  primaryNumericKind,
} from '../../lib/metricMeta'
import { bandSeriesFor, type Prober } from '../../lib/targetGroups'
import { availability, availabilityOutages, toPoints, type Pt } from '../../lib/timeline'
import { formatAvailability, formatAvailabilityRounds } from '../../lib/targetStatus'
import { targetIndex } from '../../targetStatus'
import { fmtByUnit, isByteUnit } from '../../lib/format'
import { agentLabel } from '../../lib/agentLabel'
import { baselineSpans } from '../../lib/baselineBand'
import { chartCoverage, makeChartWindow, type ChartCoverage, type ChartWindow } from '../../lib/chartWindow'

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
const { metricLabel, unitLabel, fmtDur, fmtTime } = useMetricMeta()
const { buildCard, buildSummaryCard } = useMetricCards()

const samples = ref<Record<string, Sample[]>>({}) // key: `${agentId}::${kind}`
// Server-side raw summaries for latest-only diagnostics (HTTP status/reuse,
// NAT and classifiers). key: `${agentId}::${kind}`.
const summaries = ref<Record<string, KindSummary>>({})
const faults = ref<FaultSignal[]>([])
const fluctuations = ref<Fluctuation[]>([])
const fluxTotal = ref(0)
const fluxLoaded = ref(false)
const loading = ref(false)
const refreshingEvidence = ref(false)
const timeWindow = ref<ChartWindow>(makeChartWindow(props.rangeSec))
interface AvailabilitySnapshotRow {
  availability?: number
  availabilityRounds: number
  availabilityOkRounds: number
}
// Historical availability belongs to the same frozen evidence window as the
// samples. Keep only those fields here; online/execution/probe/fault state still
// comes from the live target-status row below and may react to SSE updates.
const availabilitySnapshot = ref<Record<string, AvailabilitySnapshotRow>>({})
let dataSeq = 0
let faultSeq = 0
let fluxSeq = 0
let baselineSeq = 0
let evidenceSeq = 0

const skey = (agentId: string, kind: string) => `${agentId}::${kind}`

// Authoritative current status for this target across agents (batch).
const storeRow = computed(() => (props.monitorId ? targetIndex.value.get(props.monitorId) : undefined))

function captureAvailability(): Record<string, AvailabilitySnapshotRow> {
  if (!props.monitorId) return {}
  const snapshot: Record<string, AvailabilitySnapshotRow> = {}
  for (const row of storeRow.value?.agents ?? []) {
    snapshot[row.agent_id] = {
      availability: row.availability,
      availabilityRounds: row.availability_rounds,
      availabilityOkRounds: row.availability_ok_rounds,
    }
  }
  return snapshot
}

// Unit for each kind, taken from whichever prober records it.
const kindUnit = computed(() => {
  const m = new Map<string, string>()
  for (const p of props.probers) for (const s of p.series) if (!m.has(s.kind)) m.set(s.kind, s.unit)
  return m
})

const allKinds = computed(() => [...kindUnit.value.keys()].sort((a, b) => orderOf(a) - orderOf(b)))
const numericKinds = computed(() => allKinds.value.filter((k) => kindUnit.value.get(k) !== 'bool' && !INFO_KINDS.has(k)))
const statusKinds = computed(() => allKinds.value.filter((k) =>
  k !== 'probe.http.connection_reused' && isStatusKind(k, kindUnit.value.get(k) || ''),
))
// Card-only kinds shown as per-agent stat cards (categorical NAT + TCP error
// codes, and the ICMP sample count).
const cardKinds = computed(() => allKinds.value.filter((k) => INFO_KINDS.has(k)))

const selectedNumeric = ref<string[]>([])

// The historical band series used for the summary's availability/outages.
const band = computed(() => bandSeriesFor(props.family))
// User-created probes have a server-derived verdict for every completed round.
// Unlike family metrics (for example HTTP status or averaged ICMP loss), this
// remains an exact success ratio after minute/hour rollup and therefore keeps
// availability consistent when the range crosses a storage-tier boundary.
const ROUND_AVAILABILITY_KIND = 'probe.round.ok'
const bandSampleKind = computed(() => props.monitorId && band.value ? ROUND_AVAILABILITY_KIND : band.value?.kind ?? '')
// The headline numeric shown as "latest" in the summary (RTT / resolve / latency).
const primaryNumeric = computed(() => primaryNumericKind(props.family, numericKinds.value))

// Discrete diagnostics render as latest-value cards only. The summary endpoint
// reads raw observations, so rollup averages can never masquerade as a state.
const summaryKinds = computed(() => cardKinds.value.filter((k) => LATEST_ONLY_KINDS.has(k)))

// Every kind we need to fetch per agent as a sample series: selected charts +
// status bands + non-code card kinds + the summary's band source + the headline
// numeric. Latest-only kinds are excluded — see summaryKinds.
const fetchKinds = computed(() => {
  const set = new Set<string>([...selectedNumeric.value, ...statusKinds.value, ...cardKinds.value])
  for (const k of LATEST_ONLY_KINDS) set.delete(k)
  if (bandSampleKind.value) set.add(bandSampleKind.value)
  if (primaryNumeric.value) set.add(primaryNumeric.value)
  return [...set]
})

function applyDefaults() {
  selectedNumeric.value = defaultNumericKinds(props.family, numericKinds.value)
}

function toggleNumeric(k: string) {
  const set = new Set(selectedNumeric.value)
  if (set.has(k)) set.delete(k)
  else set.add(k)
  selectedNumeric.value = numericKinds.value.filter((x) => set.has(x))
  loadData()
}

const samplesFor = (agentId: string, kind: string) => samples.value[skey(agentId, kind)] ?? []

function bandPoints(agentId: string): Pt[] {
  const b = band.value
  if (!b) return []
  const points = toPoints(samplesFor(agentId, bandSampleKind.value))
  // probe.round.ok rollups are already success ratios and must not be rounded
  // back to booleans. Monitor-less system bands still use their family mapping.
  return props.monitorId ? points : points.map((point) => ({ ...point, v: b.toUp(point.v) }))
}

function statusSamplesFor(agentId: string, kind: string): Sample[] {
  return band.value?.kind === kind ? samplesFor(agentId, bandSampleKind.value) : samplesFor(agentId, kind)
}

// ALERT-003: the learned "usual" corridor for the chart's judged latency metric,
// per Agent. Keyed by agent id because the same target seen from two vantage
// points has two genuinely different normals — averaging them would draw a
// corridor neither Agent has ever measured.
const baselines = ref<Record<string, TargetBaseline>>({})
// Only the FIRST prober's corridor is drawn. The chart overlays one line per
// Agent, and one shaded rectangle per Agent would stack into a grey wash that
// says nothing about any of them; with several Agents the corridor is dropped
// rather than made ambiguous.
const baselineForChart = computed(() =>
  props.probers.length === 1 ? (baselines.value[props.probers[0].agent.id] ?? null) : null,
)
function spansFor(kind: string) {
  const b = baselineForChart.value
  if (!b || b.metric_kind !== kind) return []
  return baselineSpans(b, timeWindow.value.startMs, timeWindow.value.endMs)
}

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

// Status timelines keep the range availability beside each Agent label. The
// percentage remains a summary; the coloured cells and tooltip carry the time
// evidence behind it.
function statusChartMetrics(kind: string) {
  return props.probers.map((p, i) => {
    const raw = statusSamplesFor(p.agent.id, kind)
    const authoritative = summary.value.find((row) => row.id === p.agent.id)?.avail ?? null
    return {
      key: p.agent.id,
      label: `${agentLabel(p.agent)} · ${authoritative ?? '—'}`,
      kind,
      unit: kindUnit.value.get(kind) || '',
      color: FALLBACK[i % FALLBACK.length],
      samples: raw,
    }
  })
}
const bandNormalizer = computed(() => props.monitorId ? undefined : band.value?.toUp)
const selectedWindowLabel = computed(() => t('targetStatus.selectedWindow', {
  start: fmtTime(new Date(timeWindow.value.startMs).toISOString()),
  end: fmtTime(new Date(timeWindow.value.endMs).toISOString()),
}))
const codeWindowLimited = computed(() => props.rangeSec > SUMMARY_MAX_SEC && summaryKinds.value.length > 0)

// Availability% → tone (historical, threshold-based; never current inference).
function availTone(pct: number | null): 'good' | 'bad' | 'warn' | 'unknown' {
  if (pct === null) return 'unknown'
  return pct >= 99 ? 'good' : pct >= 95 ? 'warn' : 'bad'
}

// Per-agent stat card for a card-only kind. Discrete diagnostics build from the
// server-side raw summary; numeric counts keep sample-window statistics.
function agentCards(kind: string): { agent: string; card: Card }[] {
  return props.probers
    .filter((p) => p.series.some((s) => s.kind === kind))
    .map((p) => ({
      agent: agentLabel(p.agent),
      card: LATEST_ONLY_KINDS.has(kind)
        ? buildSummaryCard({ label: metricLabel(kind), color: kindColor(kind), kind }, summaries.value[skey(p.agent.id, kind)])
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
  rounds: string | null
  coverage: ChartCoverage
  outages: number
  latest: string
}
// The agent set is the batch's applicable agents (so blocked/pending/offline
// agents appear even without series); monitor-less system series fall back to the
// probers that record data.
const summary = computed<SummaryRow[]>(() => {
  const now = timeWindow.value.endMs
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
    const historical = availabilitySnapshot.value[base.id]
    let avail: number | null = historical?.availability == null ? null : historical.availability * 100
    let rounds = historical
      ? formatAvailabilityRounds(historical.availabilityOkRounds, historical.availabilityRounds)
      : null
    let outages = 0
    if (b) {
      const pts = bandPoints(base.id)
      if (pts.length) {
        // Monitor-less system series have no authoritative round-count row, so
        // they retain the sample-derived fallback. Real monitors always use the
        // server's verdict-round ratio above; samples are visual evidence only.
        if (!props.monitorId) {
          avail = availability(pts, now) * 100
          rounds = null
        }
        outages = availabilityOutages(pts)
      }
    }
    const coverage = chartCoverage([samplesFor(base.id, bandSampleKind.value)], timeWindow.value)
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
      avail: avail === null ? null : formatAvailability(avail / 100),
      rounds,
      coverage,
      outages,
      latest,
    }
  })
})

function coverageText(row: SummaryRow): string {
  if (!row.coverage.pointCount) return t('targetStatus.coverageNone')
  if (row.coverage.pointCount === 1) {
    return t('targetStatus.coverageSingle', { time: fmtTime(new Date(row.coverage.firstObservedMs!).toISOString()) })
  }
  return t('targetStatus.coverageSpan', {
    duration: fmtDur(row.coverage.spanMs / 1000),
    n: row.coverage.pointCount.toLocaleString(),
  })
}

async function loadData() {
  const seq = ++dataSeq
  const nextWindow = makeChartWindow(props.rangeSec)
  const nextAvailability = captureAvailability()
  const kinds = fetchKinds.value
  const codes = summaryKinds.value
  if (!props.probers.length || (!kinds.length && !codes.length)) {
    samples.value = {}
    summaries.value = {}
    availabilitySnapshot.value = nextAvailability
    timeWindow.value = nextWindow
    loading.value = false
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
  // One raw-summary request per agent covers all latest-only kinds. The window follows
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
  availabilitySnapshot.value = nextAvailability
  timeWindow.value = nextWindow
  const sums: Record<string, KindSummary> = {}
  for (const [agentId, kindMap] of summaryResults) {
    for (const [k, ks] of Object.entries(kindMap)) sums[skey(agentId, k)] = ks
  }
  summaries.value = sums
  loading.value = false
}

// The learned baselines behind the chart corridor. Advisory in every direction: a
// system series has no target to ask about, a target kind with no latency concept
// answers nothing, and a failure leaves the chart undecorated rather than
// blocking it. Reloaded with the data because a target's history grows.
async function loadBaselines() {
  // Single-flight guarded like every other loader here. Without it, switching
  // target while a request is in flight lets the older response land last and
  // shade the NEW target with the old one's learned corridor — most visible when
  // both are probed by the same Agent on the same metric, where nothing about
  // the drawn band looks wrong.
  const seq = ++baselineSeq
  if (!props.monitorId || props.probers.length !== 1) {
    baselines.value = {}
    return
  }
  const agentID = props.probers[0].agent.id
  try {
    const b = await api.targetBaseline(props.monitorId, agentID)
    if (seq !== baselineSeq) return
    baselines.value = { [agentID]: b }
  } catch {
    if (seq === baselineSeq) baselines.value = {}
  }
}

// Confirmed fault history for this target and selected range, newest confirmation
// first. Signals are target-scoped (one request covers every Agent), and each row carries its own
// frozen evidence, so nothing here is re-derived from metric samples. A
// monitor-less system series has no target id to scope by and shows no records.
async function loadFaults() {
  const seq = ++faultSeq
  if (!props.monitorId) {
    faults.value = []
    return
  }
  try {
    // On the single-agent history route the page is scoped to one Agent, so the
    // records must be too — arriving from "3 fluctuations on Agent A" and landing on
    // a table mixing A, B and C makes the number unverifiable.
    const list = await api.faultSignals({
      target: props.monitorId,
      agent: props.restrictToProbers && props.probers.length === 1 ? props.probers[0].agent.id : undefined,
      since: Math.floor(Date.now() / 1000) - props.rangeSec,
      limit: 20,
    })
    if (seq !== faultSeq) return
    faults.value = [...list].sort((a, b) => new Date(b.confirmed_at).getTime() - new Date(a.confirmed_at).getTime())
  } catch {
    if (seq === faultSeq) faults.value = []
  }
}

// Fluctuations over the selected range: the sub-threshold streaks that explain an
// availability figure below 100% with no fault behind it. Scoped to the range
// picker (unlike the fault list, which is a fixed recent history) because that is
// the question being asked here — what happened during the window I am looking at.
//
// fluxTotal is the server's full match count, kept apart from the loaded rows so a
// range with more dips than the page cap still reports the true number. fluxLoaded
// distinguishes "none" from "never asked": a monitor-less system series and a failed
// request both leave the list empty, and rendering 0 for either would answer the
// question this table exists to answer with a fact we do not have.
const FLUX_PAGE = 500
async function loadFluctuations() {
  const seq = ++fluxSeq
  if (!props.monitorId) {
    fluctuations.value = []
    fluxTotal.value = 0
    fluxLoaded.value = false
    return
  }
  try {
    const res = await api.fluctuations({
      target: props.monitorId,
      agent: props.restrictToProbers && props.probers.length === 1 ? props.probers[0].agent.id : undefined,
      since: Math.floor(Date.now() / 1000) - props.rangeSec,
      limit: FLUX_PAGE,
    })
    if (seq !== fluxSeq) return
    fluctuations.value = res.items
    fluxTotal.value = res.total
    fluxLoaded.value = true
  } catch {
    if (seq !== fluxSeq) return
    fluctuations.value = []
    fluxTotal.value = 0
    fluxLoaded.value = false
  }
}

// Per-Agent availability over the server's fixed windows. Rounds that reached no
// verdict are absent from the denominator, and an Agent with no verdict at all in
// a window is simply missing here — rendered "unknown" rather than 0%.
// Fluctuations per Agent over the range, for the summary column beside outages.
// Counted client-side from the rows already loaded rather than with one request
// per Agent.
const fluxCountByAgent = computed(() => {
  const m = new Map<string, number>()
  for (const f of fluctuations.value) m.set(f.agent_id, (m.get(f.agent_id) ?? 0) + 1)
  return m
})

// True when the range holds more dips than one page, so the table can say the list
// is partial instead of quietly under-reporting.
const fluxTruncated = computed(() => fluxTotal.value > fluctuations.value.length)

// Per-Agent cell text. Every neighbouring column distinguishes unknown from zero and
// so must this one — "0 fluctuations" is a claim, not a placeholder. Two ways to not
// know: the request failed, or it returned a capped page, in which case an Agent
// whose dips all fell outside that page would read as a confident 0. The card header
// still reports the true total for the range.
const fluxCell = (agentId: string): string =>
  fluxLoaded.value && !fluxTruncated.value ? String(fluxCountByAgent.value.get(agentId) ?? 0) : '—'

async function refreshEvidence(includeBaselines: boolean) {
  const seq = ++evidenceSeq
  refreshingEvidence.value = true
  const jobs: Promise<unknown>[] = [loadData(), loadFaults(), loadFluctuations()]
  if (includeBaselines) jobs.push(loadBaselines())
  await Promise.all(jobs)
  if (seq === evidenceSeq) refreshingEvidence.value = false
}

function reload() {
  applyDefaults()
  void refreshEvidence(true)
}

watch([
  () => props.monitorId,
  () => props.target,
  () => props.probers.map((p) => p.agent.id).join(','),
], reload)
// Every historical source is range-scoped, so they reload together.
watch(() => props.rangeSec, () => {
  void refreshEvidence(false)
})
onMounted(reload)
</script>

<template>
  <div class="across" :class="{ refreshing: refreshingEvidence }" :aria-busy="refreshingEvidence">
    <div v-if="refreshingEvidence" class="evidence-loading" role="status">{{ t('chart.loading') }}</div>
    <section class="availability-section" :aria-labelledby="`availability-${monitorId || family}`">
      <header class="section-head">
        <div>
          <h3 :id="`availability-${monitorId || family}`">{{ t('targetStatus.availabilityEvidenceTitle') }}</h3>
          <p>{{ t('targetStatus.availabilityEvidenceHint') }}</p>
        </div>
        <div class="window-context">
          <strong>{{ t('targetStatus.probedBy', { n: probers.length }) }}</strong>
          <span>{{ selectedWindowLabel }}</span>
        </div>
      </header>

      <!-- Availability is the authoritative verdict-round ratio. The adjacent
           band is evidence coverage, not another percentage: neutral space is
           time the server has no probe verdict for. -->
      <div class="summary-shell">
      <table>
        <thead>
          <tr>
            <th>{{ t('targetStatus.thAgent') }}</th>
            <th>{{ t('targetStatus.thCurrent') }}</th>
            <th>{{ t('targetStatus.thAvailability') }}</th>
            <th>{{ t('targetStatus.thCoverage') }}</th>
            <th>{{ t('targetStatus.thEvents') }}</th>
            <th class="num">{{ t('targetStatus.thLatest') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in summary" :key="r.id">
            <td class="mono">
              <span class="mobile-label">{{ t('targetStatus.thAgent') }}</span>
              <span class="dot-inline" :class="r.online ? 'on' : 'off'"></span>{{ r.agent }}
            </td>
            <td class="event-cell">
              <span class="mobile-label">{{ t('targetStatus.thCurrent') }}</span>
              <span v-if="r.row" class="op-cell">
                <MonitorStateBadge dim="execution" :state="r.row.execution_state" />
                <MonitorStateBadge v-if="r.row.probe_state !== 'not_applicable'" dim="probe" :state="r.row.probe_state" />
                <MonitorStateBadge v-if="r.row.fault_state !== 'normal'" dim="fault" :state="r.row.fault_state" />
              </span>
              <span v-else class="hint">—</span>
            </td>
            <td>
              <span class="mobile-label">{{ t('targetStatus.thAvailability') }}</span>
              <div class="availability-value" :class="`t-${r.availTone}`">
                <strong class="mono">{{ r.avail === null ? '—' : r.avail }}</strong>
                <span>{{ r.rounds || t('targetStatus.noVerdictRounds') }}</span>
              </div>
            </td>
            <td class="coverage-cell">
              <span class="mobile-label">{{ t('targetStatus.thCoverage') }}</span>
              <StatusBand
                :samples="samplesFor(r.id, bandSampleKind)"
                :to-up="bandNormalizer"
                :time-window="timeWindow"
                :label="t('targetStatus.coverageAria', { agent: r.agent, coverage: coverageText(r) })"
              />
              <span>{{ coverageText(r) }}</span>
            </td>
            <td>
              <span class="mobile-label">{{ t('targetStatus.thEvents') }}</span>
              <div class="event-counts">
                <span><strong class="mono">{{ r.avail === null ? '—' : r.outages }}</strong>{{ t('targetStatus.thOutages') }}</span>
                <span :title="t('targetStatus.fluctuationsHint')"><strong class="mono">{{ fluxCell(r.id) }}</strong>{{ t('targetStatus.thFluctuations') }}</span>
              </div>
            </td>
            <td class="num mono latest-cell"><span class="mobile-label">{{ t('targetStatus.thLatest') }}</span>{{ r.latest }}</td>
          </tr>
        </tbody>
      </table>
      </div>
      <div class="availability-legend" aria-hidden="true">
        <span><i class="legend-swatch observed"></i>{{ t('targetStatus.legendObserved') }}</span>
        <span><i class="legend-swatch interrupted"></i>{{ t('targetStatus.legendInterrupted') }}</span>
        <span><i class="legend-swatch unknown"></i>{{ t('targetStatus.legendUnknown') }}</span>
      </div>
    </section>

    <!-- numeric metric picker -->
    <div class="fg metric-picker" v-if="numericKinds.length > 1">
      <span>{{ t('metrics.metricPicker') }}</span>
      <div class="chips">
        <button
          v-for="k in numericKinds"
          :key="k"
          type="button"
          class="chip"
          :class="{ active: selectedNumeric.includes(k) }"
          :aria-pressed="selectedNumeric.includes(k)"
          :style="{ '--c': kindColor(k) }"
          @click="toggleNumeric(k)"
        >
          <i class="cdot" :style="{ background: kindColor(k) }"></i>{{ metricLabel(k) }}
        </button>
      </div>
    </div>

    <!-- one trend chart per selected numeric kind, one line per agent -->
    <div class="card chart-card" v-for="k in numericKinds.filter((x) => selectedNumeric.includes(x))" :key="k">
      <MetricChart
        :title="`${familyLabel} · ${metricLabel(k)}`"
        :metrics="chartMetrics(k)"
        :range-sec="rangeSec"
        :time-window="timeWindow"
        :loading="loading"
        :baseline-spans="spansFor(k)"
      />
      <p v-if="spansFor(k).length" class="chart-note hint">{{ t('metrics.baselineBand') }}</p>
    </div>

    <!-- Boolean state uses the same time axis as trends, but is split into
         inspectable cells so an outage can be located instead of hidden in one
         continuous availability bar. -->
    <div class="card chart-card status-chart-card" v-for="k in statusKinds" :key="k">
      <MetricChart
        :title="metricLabel(k)"
        :metrics="statusChartMetrics(k)"
        :range-sec="rangeSec"
        :time-window="timeWindow"
        :loading="loading"
      />
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
    <p v-if="codeWindowLimited" class="range-caveat">{{ t('metrics.codeWindowLimited') }}</p>

    <!-- Confirmed fault history. Every column is frozen at confirmation time, so a
         later rename or deletion of the target cannot rewrite what it said. -->
    <FaultSignalsTable :signals="faults" show-agent />

    <!-- And the dips that never became faults: the reason an availability figure
         above can read 99% while the table above it is empty. Only for real monitors:
         a monitor-less system series has no target, so "fluctuations" is not a
         question that applies to it rather than one whose answer is none. -->
    <FluctuationsTable
      v-if="monitorId"
      :items="fluctuations"
      show-agent
      :loaded="fluxLoaded"
      :total="fluxTruncated ? fluxTotal : undefined"
    />
  </div>
</template>

<style scoped>
/* Hallmark · component: availability evidence workspace · genre: modern-minimal · theme: NetTact tokens
 * states: default · hover · focus · active · disabled · loading · error · success
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 */
.availability-section {
  min-width: 0;
  margin-bottom: var(--space-md);
}
.across {
  position: relative;
  container-type: inline-size;
}
.across.refreshing > :not(.evidence-loading) {
  visibility: hidden;
}
.evidence-loading {
  position: absolute;
  z-index: 1;
  inset: var(--space-lg) 0 auto;
  display: grid;
  min-height: 160px;
  place-items: center;
  color: var(--color-muted);
  font-size: var(--text-sm);
  pointer-events: none;
}
.section-head {
  display: flex;
  min-width: 0;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-sm);
  padding-bottom: var(--space-sm);
  border-bottom: var(--rule-hair) solid var(--color-rule);
}
.section-head > div:first-child {
  min-width: 0;
}
.section-head h3 {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: var(--text-md);
  font-style: normal;
  letter-spacing: 0;
}
.section-head p {
  max-width: 72ch;
  margin: var(--space-3xs) 0 0;
  color: var(--color-muted);
  font-size: var(--text-xs);
}
.window-context {
  display: grid;
  flex: 0 0 auto;
  justify-items: end;
  gap: var(--space-3xs);
  text-align: right;
}
.window-context strong {
  color: var(--color-ink-2);
  font-size: var(--text-xs);
}
.window-context span {
  color: var(--color-muted);
  font-family: var(--font-outlier);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}
.summary-shell {
  overflow-x: auto;
  border-bottom: var(--rule-hair) solid var(--color-rule);
}
.summary-shell table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}
.summary-shell th,
.summary-shell td {
  text-align: left;
  padding: var(--space-xs) var(--space-2xs);
  border-bottom: var(--rule-hair) solid var(--color-rule);
  vertical-align: middle;
}
.summary-shell tbody tr:last-child td {
  border-bottom: none;
}
.summary-shell th {
  color: var(--color-muted);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0;
  text-transform: uppercase;
}
.summary-shell .num {
  text-align: right;
}
.summary-shell th:first-child,
.summary-shell td:first-child {
  padding-left: var(--space-sm);
}
.summary-shell th:last-child,
.summary-shell td:last-child {
  padding-right: var(--space-sm);
}
.mono {
  font-variant-numeric: tabular-nums;
}
.mobile-label {
  display: none;
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
.availability-value {
  display: grid;
  gap: var(--space-3xs);
}
.availability-value strong {
  font-size: var(--text-md);
  line-height: 1;
}
.availability-value span,
.coverage-cell > span,
.event-counts span {
  color: var(--color-muted);
  font-size: var(--text-xs);
}
.coverage-cell {
  width: clamp(180px, 24vw, 360px);
}
.coverage-cell :deep(.band) {
  height: 12px;
  margin-bottom: var(--space-3xs);
  border: var(--rule-hair) solid var(--color-rule);
}
.event-counts {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.event-counts span {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-3xs);
  white-space: nowrap;
}
.event-counts strong {
  color: var(--color-ink);
  font-size: var(--text-sm);
}
.availability-legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-sm) 0;
  color: var(--color-muted);
  font-size: var(--text-xs);
}
.availability-legend span {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3xs);
}
.legend-swatch {
  width: 18px;
  height: 6px;
  border-radius: var(--radius-pill);
}
.legend-swatch.observed {
  background: var(--color-success);
}
.legend-swatch.interrupted {
  border: var(--rule-hair) dashed var(--color-danger-text);
  background: var(--color-danger);
}
.legend-swatch.unknown {
  border: var(--rule-hair) solid var(--color-rule);
  background: var(--color-glass-subtle);
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
  letter-spacing: 0;
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
  max-width: 100%;
  min-width: 0;
  overflow-wrap: anywhere;
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
  margin-bottom: var(--space-md);
}
.chart-note {
  margin: 0;
  padding: 0 var(--space-sm) var(--space-xs);
  font-size: var(--text-xs);
}
.t-good {
  color: var(--color-success-text);
}
.t-bad {
  color: var(--color-danger-text);
}
.t-warn {
  color: var(--color-warning-text);
}
.t-unknown {
  color: var(--text-dim);
}
.nat-block {
  margin-bottom: 18px;
}
.range-caveat {
  margin: calc(-1 * var(--space-xs)) 0 var(--space-md);
  color: var(--color-muted);
  font-size: var(--text-xs);
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

@container (max-width: 42.5rem) {
  .section-head {
    display: grid;
    align-items: start;
  }
  .window-context {
    justify-items: start;
    text-align: left;
  }
  .summary-shell {
    overflow: visible;
    border: 0;
  }
  .summary-shell table,
  .summary-shell tbody,
  .summary-shell tr,
  .summary-shell td {
    display: block;
    width: 100%;
  }
  .summary-shell thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .summary-shell tr {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--space-xs) var(--space-sm);
    padding: var(--space-sm) 0;
    border-bottom: var(--rule-hair) solid var(--color-rule);
  }
  .summary-shell tbody tr:last-child {
    border-bottom: var(--rule-hair) solid var(--color-rule);
  }
  .summary-shell td,
  .summary-shell td:first-child,
  .summary-shell td:last-child {
    padding: 0;
    border: 0;
    text-align: left;
  }
  .summary-shell .coverage-cell {
    width: auto;
    grid-column: 1 / -1;
  }
  .summary-shell .event-cell {
    grid-column: 1 / -1;
  }
  .event-counts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-xs);
  }
  .event-counts span {
    min-width: 0;
    white-space: normal;
  }
  .summary-shell .num {
    text-align: left;
  }
  .mobile-label {
    display: block;
    margin-bottom: var(--space-3xs);
    color: var(--color-muted);
    font-size: var(--text-xs);
    font-weight: 500;
  }
  .availability-legend {
    padding-inline: 0;
  }
  .chart-card {
    margin-bottom: var(--space-sm);
  }
}
</style>
