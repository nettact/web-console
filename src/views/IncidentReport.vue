<script setup lang="ts">
// Self-contained incident diagnostic report (INCIDENT-004). A document, not a UI
// surface — so it deliberately renders as a light "paper" sheet whether the
// console is in light or dark mode, so the exported PDF looks the same for
// everyone and stays legible in black & white. Everything it shows is a frozen
// server fact already visible in the incident detail drawer; the report just
// assembles them for people who do not use NetTact.
//
// PDF export rasterizes the report client-side (html2canvas + jsPDF, loaded
// lazily) and downloads a real multi-page PDF — no browser print dialog, which
// would invite picking a real printer or hunting for "Save as PDF". The print
// stylesheet below remains only for a manual Ctrl+P. v1 shares the exported PDF
// file; in-app anonymous share links are out of scope (see the todo).
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { loadIncidentReport, type IncidentReportData } from '../composables/useIncidentReport'
import {
  useIncidentLabels,
  severityTone,
  statusTone,
} from '../composables/useIncidentLabels'
import { useMetricMeta } from '../composables/useMetricMeta'
import { toDateLocale } from '../i18n'
import { isDegradation } from '../lib/detection'
import { fmtBytes } from '../lib/format'
import { formatAvailability } from '../lib/targetStatus'
import { generateReportPdf, reportFilename } from '../lib/reportPdf'
import { pushToast } from '../toasts'
import type { FaultSignal, ProbeRound, SceneEntry, TimelineEntry, TraceReportView } from '../api'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const {
  sevLabel,
  layerLabel,
  kindLabel,
  resolveReasonLabel,
  comparatorSymbol,
  attributionLabel,
  attributionSentence,
  clueLabel,
  cluePolarity,
  snapReasonLabel,
  sceneTriggerLabel,
  fieldGroupLabel,
  groupStatusLabel,
  traceStatusLabel,
  modeLabel,
  traceReasonDetail,
  fallbackReasonDetail,
  traceSubjectLabel,
  traceSubjectDetail,
  tracePathScopeLabel,
  tracePathScopeDetail,
  tracePathScopeReading,
  errorClassLabel,
} = useIncidentLabels()
const { metricLabel, probeReasonLabel } = useMetricMeta()

const data = ref<IncidentReportData | null>(null)
const loading = ref(true)
const error = ref('')
const generatedAt = ref('')
const reportLogoSource = '/nettact-logo-horizontal.svg'

const fmtDateTime = (s: string | null) =>
  s ? new Date(s).toLocaleString(toDateLocale(locale.value), { hour12: false }) : '—'
const fmtRoundTime = (epochSec: number) =>
  new Date(epochSec * 1000).toLocaleString(toDateLocale(locale.value), { hour12: false })
const fmtNum = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2))

const incident = computed(() => data.value?.detail.incident ?? null)
const members = computed(() => data.value?.detail.members ?? [])
const timeline = computed(() => data.value?.timeline ?? [])
const snapshot = computed(() => data.value?.snapshot ?? null)
const traces = computed(() => data.value?.traces ?? [])
const precursors = computed(() => data.value?.precursors ?? [])
const precursorTotal = computed(() => data.value?.precursorTotal ?? 0)
const version = computed(() => data.value?.version ?? '')
// A context read failed: the section must say "could not read this" rather than
// borrow the "none existed" empty-state wording.
const snapshotFailed = computed(() => data.value?.failed.snapshot ?? false)
const tracesFailed = computed(() => data.value?.failed.traces ?? false)
const precursorsFailed = computed(() => data.value?.failed.precursors ?? false)
const availabilityFailed = computed(() => data.value?.failed.availability ?? false)
const attrClues = computed(() => incident.value?.attribution_evidence ?? [])
const attributionLine = computed(() =>
  incident.value ? attributionSentence(incident.value.attribution ?? '', attrClues.value) : '',
)

// The heading follows the console language. A single-signal incident's heading
// is that signal's standard statement; a merged incident's heading is derived
// from the localized members (counting DISTINCT targets, not signals — several
// agents observing the same target is one affected target), because the server
// stores the incident title in the default language only.
const reportHeading = computed(() => {
  if (members.value.length === 1) return memberTitle(members.value[0])
  const distinctTargets = new Set(
    members.value.map((m) => m.target_id).filter((t): t is string => !!t),
  ).size
  if (members.value.length > 1 && distinctTargets > 0) {
    return t('incidents.report.headingMulti', { n: distinctTargets, first: memberTitle(members.value[0]) })
  }
  return incident.value?.title || incident.value?.summary || '—'
})

// Timeline messages are stored server-side in the default language. The rows
// that restate the failure statement (kind fault.confirmed, ref = a member id)
// are re-derived from the locale-aware member description so an English report
// stays English. Recovery/termination rows say something else — substituting the
// failure sentence there would contradict "fault recovered | Router unreachable"
// — so only confirmation rows are substituted.
function timelineMessage(e: TimelineEntry): string {
  if (e.ref && e.kind === 'fault.confirmed') {
    const m = members.value.find((x) => x.id === e.ref)
    if (m) return memberTitle(m)
  }
  return e.message
}

// Duration of the fault (opened → resolved, or opened → now while still open).
function since(from: string, to: string | null): string {
  const end = to ? new Date(to).getTime() : Date.now()
  const secs = Math.max(0, Math.round((end - new Date(from).getTime()) / 1000))
  if (secs < 60) return t('incidents.durSeconds', { n: secs })
  if (secs < 3600) return t('incidents.durMinutes', { n: Math.round(secs / 60) })
  if (secs < 86400) return t('incidents.durHours', { n: Math.round(secs / 360) / 10 })
  return t('incidents.durDays', { n: Math.round(secs / 8640) / 10 })
}
const durationText = computed(() =>
  incident.value ? since(incident.value.first_observed_at, incident.value.resolved_at) : '',
)

function memberStateKey(m: FaultSignal) {
  if (m.state === 'firing') return 'firing'
  return m.resolve_reason && m.resolve_reason !== 'recovered' ? 'terminated' : 'resolved'
}
const memberStateLabel = (m: FaultSignal) => t(`incidents.detail.memberState.${memberStateKey(m)}`)

// Confirm lag in seconds — how long the detector took to meet its threshold.
const confirmLagSecs = (m: FaultSignal) =>
  Math.max(0, Math.round((new Date(m.confirmed_at).getTime() - new Date(m.observed_at).getTime()) / 1000))
const confirmLagText = (m: FaultSignal) => t('incidents.detail.confirmLagValue', { n: confirmLagSecs(m) })

// The server sends the standard statement in both languages (desc_zh/desc_en)
// plus a single-language title; the report follows the console language, so the
// locale's own description wins and the title is only a fallback for faults the
// server left without one.
function memberTitle(m: FaultSignal): string {
  return (
    (locale.value === 'en' ? m.desc_en : m.desc_zh) ||
    m.title ||
    m.target_name ||
    m.target_addr ||
    m.id
  )
}

// Severity/state chips. tone classes come from the shared severityTone; the chip
// palette is the report's own fixed light set (theme-independent document).
const sevChip = (sev: string) => severityTone(sev)
const stateChip = (m: FaultSignal) => (memberStateKey(m) === 'firing' ? 'open' : memberStateKey(m) === 'terminated' ? 'warn' : 'ok')
const groupChip = (status: string) => (status === 'collected' ? 'ok' : status === 'failed' ? 'open' : 'warn')
const traceChip = (status: string) => (statusTone(status) === 'ok' ? 'ok' : statusTone(status) === 'open' ? 'open' : 'warn')

// Per-member availability for a window: the site-wide ratio for the member's
// target. null when the fault has no target, the target is gone, or the window
// held no verdict at all (rounds == 0 means "nobody looked", not 0%).
function availabilityRatio(m: FaultSignal, window: '24h' | '7d'): number | null {
  if (!m.target_id) return null
  const av = data.value?.availability.get(m.target_id)
  const w = av?.windows.find((x) => x.window === window)
  if (!w || w.total.rounds === 0) return null
  return w.total.ratio
}
// Every round listed in a report FAILED, so a probe's 0/1 success flag must
// never be rendered as "<label> <value>": its label is affirmative ("请求成功")
// and a failing round would read as the opposite of what happened. Same rule as
// ProbeRoundsDetail — the flag is dropped rather than reworded. loss_pct is the
// one primary metric whose value is a magnitude, so it stays.
const isSuccessFlag = (kind: string) => kind.endsWith('.ok')
const fmtRoundValue = (r: ProbeRound) =>
  `${fmtNum(r.value)}${r.metric_kind.endsWith('_pct') ? '%' : ''}`
// A target whose availability read failed is listed by id; its rows say "read
// failed" rather than borrow the "no verdict" wording, which means no data.
const availabilityFailedTargets = computed(() => data.value?.availabilityFailedTargets ?? [])
function availabilityCell(m: FaultSignal, window: '24h' | '7d'): string {
  if (m.target_id && availabilityFailedTargets.value.includes(m.target_id)) {
    return t('incidents.report.readFailedShort')
  }
  const ratio = availabilityRatio(m, window)
  // formatAvailability never rounds an observed failure up to 100%: a 9999/10000
  // window reads 99.9%, not a false perfect.
  return formatAvailability(ratio ?? undefined) ?? t('incidents.report.noVerdict')
}
// Availability is a per-target site-wide total, so one target observed by
// several agents must print once, not once per member (which would duplicate
// identical rows). The first member of each target keeps its title.
const membersWithTarget = computed(() => {
  const seen = new Set<string>()
  return members.value.filter((m) => {
    if (!m.target_id || seen.has(m.target_id)) return false
    seen.add(m.target_id)
    return true
  })
})

// ---- traceroute helpers ----
const attemptCount = (r: TraceReportView) => r.hops.reduce((m, h) => Math.max(m, h.attempts.length), 0)
const attemptCols = (r: TraceReportView) => Array.from({ length: attemptCount(r) }, (_, i) => i)
const attemptAt = (hop: TraceReportView['hops'][number], idx: number) => hop.attempts[idx] ?? null
const traceDest = (r: TraceReportView) => {
  if (r.dest_ip && r.dest_ip !== r.dest_host) return `${r.dest_host} (${r.dest_ip})`
  return r.dest_ip || r.dest_host || '—'
}
const subjectResolved = (r: TraceReportView) => !!(r.dest_host || r.dest_ip)
const traceElapsed = (r: TraceReportView) => {
  if (!r.started_at || !r.completed_at) return '—'
  const ms = new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()
  if (ms < 0) return '—'
  return `${(ms / 1000).toFixed(1)} s`
}
// Interpretation notes in reading order: why the mode changed, what was traced,
// which path it was pinned to, how to read that path's hops, why it terminalized.
function traceNotes(r: TraceReportView): string[] {
  const notes: string[] = []
  if (r.fallback_reason) {
    const d = fallbackReasonDetail(r.fallback_reason)
    if (d) notes.push(`${modeLabel(r.fallback_from || '')}${r.port ? `:${r.port}` : ''} → ${modeLabel(r.mode)}: ${d}`)
  }
  if (r.subject_kind && r.subject_kind !== 'target' && subjectResolved(r)) {
    const d = traceSubjectDetail(r.subject_kind, r.subject_reason || '')
    if (d) notes.push(d)
  }
  if (r.path_scope && r.path_scope !== 'direct') {
    const d = tracePathScopeDetail(r.path_scope)
    if (d) notes.push(d)
  }
  if (r.path_scope !== 'direct' && r.hops.length) {
    const d = tracePathScopeReading(r.path_scope)
    if (d) notes.push(d)
  }
  if (r.reason) {
    const d = traceReasonDetail(r.reason)
    if (d) notes.push(d)
  }
  return notes
}

// ---- scene helpers ----
const aheadSeconds = (e: SceneEntry) => Math.abs(e.delivery_lag_ms / 1000).toFixed(1)

// ---- load ----
let unmounted = false
onMounted(async () => {
  try {
    const result = await loadIncidentReport(String(route.params.id))
    if (unmounted) return
    data.value = result
    generatedAt.value = fmtDateTime(new Date().toISOString())
    document.title = `${t('incidents.report.title')} · NetTact`
  } catch (e) {
    if (unmounted) return
    error.value = String((e as Error).message || e)
  } finally {
    if (!unmounted) loading.value = false
  }
})
onBeforeUnmount(() => {
  // A report load may finish after the user has left the route; discard it so a
  // stale continuation cannot repaint the destination page's document title.
  unmounted = true
  document.title = 'NetTact'
})

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/incidents')
}

// Direct PDF download: rasterize the report and save the file, with no browser
// print dialog (users would otherwise be offered a real printer and have to
// hunt for "Save as PDF"). The libraries are loaded lazily on first use.
const reportEl = ref<HTMLElement | null>(null)
const exporting = ref(false)
async function exportPdf() {
  if (exporting.value || !data.value || !reportEl.value) return
  exporting.value = true
  try {
    await generateReportPdf(reportEl.value, reportFilename(reportHeading.value, new Date()))
  } catch (e) {
    pushToast({ tone: 'danger', title: t('incidents.report.exportFailed') })
    console.error('report pdf export failed', e)
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <main class="report-page">
    <!-- Toolbar is UI, so it may follow the theme; it is hidden on print. -->
    <header class="toolbar">
      <button type="button" class="btn" @click="goBack">← {{ t('incidents.report.back') }}</button>
      <h1>{{ t('incidents.report.title') }}</h1>
      <button
        type="button"
        class="btn primary"
        :disabled="loading || !!error || !data || exporting"
        @click="exportPdf"
      >
        {{ exporting ? t('incidents.report.exporting') : t('incidents.report.exportPdf') }}
      </button>
    </header>

    <p v-if="loading" class="state">{{ t('incidents.report.loading') }}</p>
    <div v-else-if="error" class="state err">
      <p>{{ t('incidents.report.failed') }}</p>
      <p class="detail">{{ error }}</p>
      <button type="button" class="btn" @click="goBack">← {{ t('incidents.report.back') }}</button>
    </div>

    <article v-else-if="data" ref="reportEl" class="report">
      <header class="report-head">
        <img
          class="report-brand"
          :src="reportLogoSource"
          alt="NetTact"
          width="140"
          height="40"
          draggable="false"
        />
        <h1>{{ reportHeading }}</h1>
        <p v-if="attributionLine" class="attribution">{{ attributionLine }}</p>
        <ul v-if="attrClues.length" class="clues">
          <li v-for="(c, i) in attrClues" :key="c.kind + '-' + i" :class="cluePolarity(c.kind)">{{ clueLabel(c) }}</li>
        </ul>
        <dl class="facts meta">
          <div>
            <dt>{{ t('incidents.thState') }}</dt>
            <dd>{{ incident?.state === 'open' ? t('incidents.stateOpen') : t('incidents.stateResolved') }}</dd>
          </div>
          <div v-if="incident">
            <dt>{{ t('incidents.thSeverity') }}</dt>
            <dd>{{ sevLabel(incident.severity) }}</dd>
          </div>
          <div>
            <dt>{{ t('incidents.detail.group') }}</dt>
            <dd>{{ incident?.group_name || '—' }}</dd>
          </div>
          <div>
            <dt>{{ t('incidents.thSuspectedLayer') }}</dt>
            <dd>{{ incident?.attribution ? attributionLabel(incident.attribution) : incident ? layerLabel(incident.suspected_layer) : '—' }}</dd>
          </div>
          <div>
            <dt>{{ t('incidents.detail.firstObservedAt') }}</dt>
            <dd>{{ fmtDateTime(incident?.first_observed_at ?? null) }}</dd>
          </div>
          <div>
            <dt>{{ t('incidents.detail.openedAt') }}</dt>
            <dd>{{ fmtDateTime(incident?.opened_at ?? null) }}</dd>
          </div>
          <div>
            <dt>{{ t('incidents.detail.resolvedAt') }}</dt>
            <dd>{{ incident?.resolved_at ? fmtDateTime(incident.resolved_at) : t('incidents.report.notResolved') }}</dd>
          </div>
          <div>
            <dt>{{ t('incidents.thDuration') }}</dt>
            <dd>{{ durationText }}</dd>
          </div>
        </dl>
        <p v-if="incident?.evidence_expired" class="note warn" role="note">
          {{ t('incidents.detail.evidenceExpired') }}
        </p>
      </header>

      <!-- 2. Impact: targets, agents, group, confirm lag. -->
      <section class="report-section">
        <h2>{{ t('incidents.report.sectionImpact') }}</h2>
        <p v-if="!members.length" class="hint">{{ t('incidents.detail.noMembers') }}</p>
        <div v-else class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{{ t('incidents.detail.evTarget') }}</th>
                <th>{{ t('incidents.thAgent') }}</th>
                <th>{{ t('incidents.thSeverity') }}</th>
                <th>{{ t('incidents.thState') }}</th>
                <th>{{ t('incidents.detail.confirmLag') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in members" :key="m.id">
                <td>{{ memberTitle(m) }}</td>
                <td>{{ m.agent_name || m.agent_id }}</td>
                <td>{{ sevLabel(m.severity) }}</td>
                <td>{{ memberStateLabel(m) }}</td>
                <td class="mono">{{ confirmLagText(m) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 3. Evidence: each member's frozen signal + per-round failure causes. -->
      <section class="report-section">
        <h2>{{ t('incidents.report.sectionEvidence') }}</h2>
        <div v-for="m in members" :key="m.id" class="member-block">
          <div class="subhead">
            <h3>{{ memberTitle(m) }}</h3>
            <span class="chip" :class="stateChip(m)">{{ memberStateLabel(m) }}</span>
            <span class="chip" :class="sevChip(m.severity)">{{ sevLabel(m.severity) }}</span>
            <span class="chip neutral">{{ m.agent_name || m.agent_id }}</span>
            <span v-if="m.state === 'firing' && !m.currently_abnormal" class="chip warn">
              {{ t('incidents.detail.recovering') }}
            </span>
          </div>
          <dl class="facts">
            <div v-if="m.target_addr">
              <dt>{{ t('incidents.detail.evTarget') }}</dt>
              <dd class="mono">{{ m.target_addr }}</dd>
            </div>
            <!-- A baseline-judged member states the comparison that was actually
                 made. `gte_baseline` has no symbol and its threshold is a number
                 the product derived, not one anybody chose, so rendering it the
                 usual way would print "(gte_baseline 67.5)" into an exported PDF.
                 Kept in step with IncidentDetail.vue: the two surfaces describe
                 the same evidence and must not disagree. -->
            <div v-if="m.metric_kind && isDegradation(m.detector_key)">
              <dt>{{ t('incidents.detail.evVsBaseline') }}</dt>
              <dd>
                {{ metricLabel(m.metric_kind) }}
                <span class="mono">{{ fmtNum(m.value) }}</span>
                <span class="dim">
                  {{ t('incidents.detail.baselineUsual', { usual: fmtNum(m.baseline_p50) }) }}
                </span>
              </dd>
            </div>
            <div v-else-if="m.metric_kind">
              <dt>{{ t('incidents.detail.evMetric') }}</dt>
              <dd>
                {{ metricLabel(m.metric_kind) }}
                <span class="mono">{{ fmtNum(m.value) }}</span>
                <span class="dim">({{ comparatorSymbol(m.comparator) }} {{ fmtNum(m.threshold) }})</span>
              </dd>
            </div>
            <div v-if="m.reason_code > 0">
              <dt>{{ t('incidents.detail.evReason') }}</dt>
              <dd>
                {{ probeReasonLabel(m.reason_code) }}
                <span v-if="m.reason_detail" class="mono detail">{{ m.reason_detail }}</span>
              </dd>
            </div>
            <div>
              <dt>{{ t('incidents.detail.evObserved') }}</dt>
              <dd>{{ fmtDateTime(m.observed_at) }}</dd>
            </div>
            <div>
              <dt>{{ t('incidents.detail.evConfirmed') }}</dt>
              <dd>{{ fmtDateTime(m.confirmed_at) }} <span class="dim">({{ confirmLagText(m) }})</span></dd>
            </div>
            <div v-if="m.resolved_at">
              <dt>{{ t('incidents.detail.evResolved') }}</dt>
              <dd>{{ fmtDateTime(m.resolved_at) }}</dd>
            </div>
            <div>
              <dt>{{ t('incidents.detail.evSensitivity') }}</dt>
              <dd>
                {{ t('incidents.detail.sensitivityValue', { fail: m.fail_threshold, recover: m.recover_threshold }) }}
              </dd>
            </div>
            <div v-if="m.resolve_reason">
              <dt>{{ t('incidents.detail.endReason') }}</dt>
              <dd>{{ resolveReasonLabel(m.resolve_reason) }}</dd>
            </div>
          </dl>
          <div v-if="m.rounds?.length" class="table-scroll">
            <table class="rounds">
              <caption>{{ t('incidents.report.roundsTitle') }}</caption>
              <thead>
                <tr>
                  <th>{{ t('incidents.report.thTime') }}</th>
                  <th>{{ t('incidents.detail.evMetric') }}</th>
                  <th>{{ t('incidents.report.thValue') }}</th>
                  <th>{{ t('incidents.detail.evReason') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in m.rounds" :key="r.ts">
                  <td>{{ fmtRoundTime(r.ts) }}</td>
                  <td>{{ isSuccessFlag(r.metric_kind) ? '—' : metricLabel(r.metric_kind) }}</td>
                  <td class="mono">{{ isSuccessFlag(r.metric_kind) ? '—' : fmtRoundValue(r) }}</td>
                  <td>
                    {{ probeReasonLabel(r.reason_code) }}
                    <span v-if="r.reason_detail" class="mono detail">{{ r.reason_detail }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- 4. Timeline + precursor fluctuations. -->
      <section class="report-section">
        <h2>{{ t('incidents.timeline') }}</h2>
        <ul v-if="timeline.length" class="timeline">
          <li v-for="(e, idx) in timeline" :key="idx">
            <span class="ts">{{ fmtDateTime(e.ts) }}</span>
            <span class="kind">{{ kindLabel(e.kind) }}</span>
            <span class="msg">{{ timelineMessage(e) }}</span>
          </li>
        </ul>
        <p v-else class="hint">{{ t('incidents.noRecords') }}</p>

        <p v-if="precursorsFailed" class="note warn">{{ t('incidents.report.readFailed') }}</p>
        <div v-if="precursors.length" class="precursor-block">
          <h3>{{ t('incidents.precursors.title') }}</h3>
          <!-- The server caps the precursor page; a capped report must say it is
               partial rather than present the returned page as complete. -->
          <p v-if="precursors.length < precursorTotal" class="hint">
            {{ t('incidents.report.precursorCap', { shown: precursors.length, total: precursorTotal }) }}
          </p>
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{{ t('incidents.report.thStart') }}</th>
                  <th>{{ t('incidents.report.thEnd') }}</th>
                  <th>{{ t('incidents.detail.evTarget') }}</th>
                  <th>{{ t('incidents.thAgent') }}</th>
                  <th>{{ t('incidents.detail.evMetric') }}</th>
                  <th>{{ t('incidents.report.thValue') }}</th>
                  <th>{{ t('incidents.detail.evReason') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in precursors" :key="p.id">
                  <td>{{ fmtDateTime(p.started_at) }}</td>
                  <td>{{ fmtDateTime(p.ended_at) }}</td>
                  <td>{{ p.target_name || p.target_addr }}</td>
                  <td>{{ p.agent_name || p.agent_id }}</td>
                  <td>{{ isSuccessFlag(p.metric_kind) ? '—' : metricLabel(p.metric_kind) }}</td>
                  <td class="mono">
                    <template v-if="isSuccessFlag(p.metric_kind)">—</template>
                    <template v-else>{{ fmtNum(p.value) }} ({{ comparatorSymbol(p.comparator) }} {{ fmtNum(p.threshold) }})</template>
                  </td>
                  <td>{{ probeReasonLabel(p.reason_code) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- 5. Path diagnostics: shared traceroute reports with their hop tables. -->
      <section class="report-section">
        <h2>{{ t('incidents.trace.title') }}</h2>
        <p v-if="tracesFailed" class="note warn">{{ t('incidents.report.readFailed') }}</p>
        <p v-else-if="!traces.length" class="hint">{{ t('incidents.trace.none') }}</p>
        <div v-for="r in traces" :key="r.report_id" class="trace-block">
          <div class="subhead">
            <h3 class="mono">{{ traceDest(r) }}</h3>
            <span class="chip" :class="traceChip(r.status)">{{ traceStatusLabel(r.status) }}</span>
            <span class="chip neutral">{{ modeLabel(r.mode) }}<template v-if="r.port && r.fallback_from !== 'tcp'">:{{ r.port }}</template></span>
            <span v-if="r.subject_kind && r.subject_kind !== 'target'" class="chip neutral">
              {{ traceSubjectLabel(r.subject_kind) }}
            </span>
            <span v-if="r.path_scope && r.path_scope !== 'direct'" class="chip neutral">
              {{ tracePathScopeLabel(r.path_scope) }}
            </span>
          </div>
          <dl class="facts">
            <div>
              <dt>{{ t('incidents.trace.agent') }}</dt>
              <dd>{{ r.agent_name || r.agent_id }}</dd>
            </div>
            <div>
              <dt>{{ r.subject_kind && r.subject_kind !== 'target' ? traceSubjectLabel(r.subject_kind) : t('incidents.trace.dest') }}</dt>
              <dd class="mono">{{ traceDest(r) }}</dd>
            </div>
            <div>
              <dt>{{ t('incidents.trace.reached') }}</dt>
              <dd>
                {{ r.reached ? t('incidents.trace.reachedYes') : t('incidents.trace.reachedNo') }}
                <span v-if="r.reached && r.reached_ttl" class="dim"> · TTL {{ r.reached_ttl }}</span>
              </dd>
            </div>
            <div v-if="r.trigger_streak">
              <dt>{{ t('incidents.trace.trigger') }}</dt>
              <dd>{{ t('incidents.trace.triggerStreak', { n: r.trigger_streak }) }}</dd>
            </div>
            <div v-if="r.first_failed_at">
              <dt>{{ t('incidents.trace.firstFailedAt') }}</dt>
              <dd>{{ fmtDateTime(r.first_failed_at) }}</dd>
            </div>
            <div>
              <dt>{{ t('incidents.trace.startedAt') }}</dt>
              <dd>{{ fmtDateTime(r.started_at) }}</dd>
            </div>
            <div>
              <dt>{{ t('incidents.trace.finishedAt') }}</dt>
              <dd>{{ fmtDateTime(r.completed_at) }}</dd>
            </div>
            <div v-if="r.received_at">
              <dt>{{ t('incidents.trace.receivedAt') }}</dt>
              <dd>{{ fmtDateTime(r.received_at) }}</dd>
            </div>
            <div>
              <dt>{{ t('incidents.trace.duration') }}</dt>
              <dd>{{ traceElapsed(r) }}</dd>
            </div>
          </dl>
          <p v-for="note in traceNotes(r)" :key="note" class="note">{{ note }}</p>
          <div v-if="r.hops.length" class="table-scroll">
            <table :aria-label="t('incidents.trace.hopTableAria')">
              <thead>
                <tr>
                  <th>{{ t('incidents.trace.ttl') }}</th>
                  <th v-for="i in attemptCols(r)" :key="i">{{ t('incidents.trace.attemptN', { n: i + 1 }) }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="hop in r.hops" :key="hop.ttl">
                  <th scope="row" class="ttl mono">{{ hop.ttl }}</th>
                  <td v-for="i in attemptCols(r)" :key="i" class="attempt">
                    <template v-if="attemptAt(hop, i)">
                      <span v-if="attemptAt(hop, i)!.timeout" class="star" :title="t('incidents.trace.timeout')">*</span>
                      <template v-else>
                        <span class="mono">{{ attemptAt(hop, i)!.rtt_ms?.toFixed(1) ?? '—' }} ms</span>
                        <span class="mono dim">{{ attemptAt(hop, i)!.addr || '—' }}</span>
                        <span v-if="attemptAt(hop, i)!.hostname" class="mono dim">{{ attemptAt(hop, i)!.hostname }}</span>
                      </template>
                    </template>
                    <span v-else class="dim">·</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="hint">{{ t('incidents.trace.noHops') }}</p>
          <p class="disclaimer">{{ t('incidents.trace.starNote') }}</p>
          <p class="disclaimer">{{ t('incidents.trace.rootCauseNote') }}</p>
        </div>
      </section>

      <!-- 6. Snapshot summary: per-Agent key items, never a JSON dump. -->
      <section class="report-section">
        <h2>{{ t('incidents.snap.title') }}</h2>
        <p v-if="snapshotFailed" class="note warn">{{ t('incidents.report.readFailed') }}</p>
        <p v-else-if="!snapshot" class="hint">{{ t('incidents.snap.none') }}</p>
        <template v-else>
          <p v-if="snapshot.truncated" class="note warn">{{ t('incidents.snap.truncated') }}</p>
          <p v-if="!snapshot.scenes.length" class="hint">{{ t('incidents.snap.noScenes') }}</p>
          <div v-for="e in snapshot.scenes" :key="e.report_id" class="snap-agent">
            <div class="subhead">
              <h3>{{ e.agent_name || e.agent_id }}</h3>
              <span v-for="(g, i) in e.triggers" :key="`${e.report_id}:${i}`" class="chip neutral">
                {{ sceneTriggerLabel(g.kind) }}
              </span>
            </div>
            <!-- Full sentences, not chips: .chip is nowrap, and these overflow a
                 phone-width report sheet. -->
            <p v-if="e.truncated" class="note warn">{{ t('incidents.snap.truncated') }}</p>
            <p v-if="e.clock_ahead" class="note warn">
              {{ t('incidents.snap.clockAhead', { s: aheadSeconds(e) }) }}
            </p>
            <template v-if="e.payload">
              <ul v-if="e.payload.groups.length" class="group-status">
                <li v-for="g in e.payload.groups" :key="g.group">
                  <span class="field">{{ fieldGroupLabel(g.group) }}</span>
                  <span class="chip" :class="groupChip(g.status)">{{ groupStatusLabel(g.status) }}</span>
                  <span v-if="g.reason" class="dim">{{ snapReasonLabel(g.reason) }}</span>
                </li>
              </ul>
              <dl v-if="e.payload.network" class="facts">
                <div v-if="e.payload.network.default_route">
                  <dt>{{ t('incidents.snap.defaultRoute') }}</dt>
                  <dd class="mono">
                    {{ e.payload.network.default_route.gateway || '—' }}
                    <template v-if="e.payload.network.default_route.interface"> · {{ e.payload.network.default_route.interface }}</template>
                  </dd>
                </div>
                <div v-if="e.payload.network.dns_servers?.length">
                  <dt>DNS</dt>
                  <dd class="mono">{{ e.payload.network.dns_servers.join(', ') }}</dd>
                </div>
              </dl>
              <ul v-if="e.payload.network?.interfaces?.length" class="iface-list">
                <li v-for="iface in e.payload.network.interfaces" :key="iface.name">
                  <span class="chip" :class="iface.up ? 'ok' : 'open'">
                    {{ iface.up ? t('incidents.snap.ifaceUp') : t('incidents.snap.ifaceDown') }}
                  </span>
                  <b>{{ iface.name }}</b>
                  <span v-if="iface.is_wireless" class="chip neutral">{{ t('incidents.snap.wireless') }}</span>
                  <span class="mono dim">{{ iface.addrs?.join(', ') }}</span>
                </li>
              </ul>
              <p v-if="e.payload.agent" class="agent-line">
                <span class="dim">{{ t('incidents.snap.group.agent') }}:</span>
                <span class="mono">{{ e.payload.agent.hostname || '—' }} · {{ e.payload.agent.platform || '—' }} · {{ e.payload.agent.agent_version || '—' }}</span>
              </p>
              <p v-if="e.payload.resources" class="agent-line">
                <span class="dim">{{ t('incidents.snap.group.resources') }}:</span>
                <span>
                  CPU {{ e.payload.resources.cpu_percent == null ? '—' : e.payload.resources.cpu_percent.toFixed(0) + '%' }} ·
                  {{ t('incidents.snap.memory') }} {{ fmtBytes(e.payload.resources.memory_used_bytes) }} / {{ fmtBytes(e.payload.resources.memory_total_bytes) }}
                </span>
              </p>
              <div v-if="e.payload.targets?.length" class="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{{ t('incidents.snap.thTarget') }}</th>
                      <th>{{ t('incidents.snap.thResolved') }}</th>
                      <th>{{ t('incidents.snap.thEndpoints') }}</th>
                      <th>{{ t('incidents.snap.thErrorClass') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="tg in e.payload.targets" :key="tg.monitor_id">
                      <td class="mono">{{ tg.target || tg.monitor_id }}</td>
                      <td class="mono">{{ tg.resolved_ips?.join(', ') || '—' }}</td>
                      <td class="mono">{{ tg.endpoints?.join(', ') || '—' }}</td>
                      <td>{{ tg.error_class ? errorClassLabel(tg.error_class) : '—' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
          </div>
        </template>
      </section>

      <!-- 7. Related history: 24h / 7d availability per target. -->
      <section class="report-section">
        <h2>{{ t('incidents.report.sectionHistory') }}</h2>
        <p class="hint">{{ t('incidents.report.histHint') }}</p>
        <p v-if="availabilityFailed" class="note warn">{{ t('incidents.report.readFailed') }}</p>
        <p v-if="!membersWithTarget.length" class="hint">{{ t('incidents.report.noTargets') }}</p>
        <div v-else class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{{ t('incidents.detail.evTarget') }}</th>
                <th>{{ t('incidents.report.thAvail24h') }}</th>
                <th>{{ t('incidents.report.thAvail7d') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in membersWithTarget" :key="m.id">
                <td>{{ memberTitle(m) }}</td>
                <td class="mono">{{ availabilityCell(m, '24h') }}</td>
                <td class="mono">{{ availabilityCell(m, '7d') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <footer class="report-foot">
        <span>{{ t('incidents.report.generatedBy') }}</span>
        <span>{{ t('incidents.report.generatedAt') }}: {{ generatedAt }}</span>
        <span v-if="version">{{ t('incidents.report.version') }}: {{ version }}</span>
      </footer>
    </article>
  </main>
</template>

<style scoped>
/*
 * The report sheet is a document, so it pins its own light palette instead of
 * reading the console theme: an exported PDF must be identical for every user
 * and in black & white, which theme tokens cannot guarantee. This is the one
 * place in the app where a fixed background is deliberate.
 */
.report {
  --paper: #ffffff;
  --ink: #1c2733;
  --ink-2: #44546a;
  --ink-3: #71809a;
  --rule: #dfe6ee;
  --rule-2: #c6d2df;
  --chip-ok: #1d7a3f;
  --chip-ok-bg: #eff8f2;
  --chip-ok-bd: #b9dfc6;
  --chip-warn: #8a5a00;
  --chip-warn-bg: #fdf8ec;
  --chip-warn-bd: #e8d6a8;
  --chip-open: #b3261e;
  --chip-open-bg: #fdf3f2;
  --chip-open-bd: #e5b9b5;
  /* A4 width (794px at 96dpi): the sheet is a document, and pinning it here means
     the export capture needs no layout shift on desktop. */
  max-width: 794px;
  margin: 0 auto;
  padding: 40px 52px 32px;
  border: var(--rule-hair, 1px) solid var(--rule-2);
  border-radius: 14px;
  background: var(--paper);
  color: var(--ink);
  font-size: 14px;
  line-height: 1.6;
  font-family: system-ui, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Segoe UI', sans-serif;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.report-page {
  min-height: 100vh;
  padding: var(--space-md);
  background: var(--surface-solid);
}

.toolbar {
  position: sticky;
  top: 0;
  z-index: var(--z-sticky, 20);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  max-width: 840px;
  margin: 0 auto var(--space-sm);
  padding: var(--space-2xs) 0;
}
.toolbar h1 {
  font-family: var(--font-display);
  font-size: var(--text-md);
}
.toolbar .btn {
  min-height: 2.5rem;
  padding: var(--space-2xs) var(--space-sm);
  border: var(--rule-hair, 1px) solid var(--color-rule-2, currentColor);
  border-radius: var(--radius-input, 10px);
  background: var(--color-glass-subtle, transparent);
  color: var(--color-ink, currentColor);
  font-size: var(--text-sm);
  cursor: pointer;
}
.toolbar .btn.primary {
  color: var(--color-primary-action-text, #fff);
  border-color: transparent;
  background: var(--color-primary-action-bg, #0b7cbf);
}

.state {
  max-width: 840px;
  margin: var(--space-lg) auto;
  padding: var(--space-md);
  text-align: center;
  color: var(--color-ink-2);
}
.state.err .detail {
  color: var(--color-danger-text, #b3261e);
  font-size: var(--text-xs);
}

/* ---- document header ---- */
.report-head {
  padding-bottom: 22px;
  border-bottom: 2px solid var(--rule);
}
.report-brand {
  display: block;
  width: 140px;
  height: 40px;
  margin-bottom: 14px;
  object-fit: contain;
}
.report-head h1 {
  margin: 0;
  font-size: 24px;
  line-height: 1.3;
  letter-spacing: -0.01em;
}
.attribution {
  margin: 14px 0 0;
  padding: 10px 14px;
  border: 1px solid var(--rule-2);
  border-radius: 8px;
  background: #f5f8fb;
  font-size: 14.5px;
  font-weight: 600;
  line-height: 1.5;
}
.clues {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 0 0;
  padding: 0;
}
.clues li {
  padding: 2px 9px;
  border: 1px solid var(--rule);
  border-radius: 999px;
  font-size: 12px;
  color: var(--ink-2);
}
.clues li.ok {
  color: var(--chip-ok);
  border-color: var(--chip-ok-bd);
}
.clues li.fail {
  color: var(--chip-open);
  border-color: var(--chip-open-bd);
}

/* ---- shared pieces ---- */
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 26px;
  margin: 10px 0 0;
}
.facts > div {
  display: flex;
  gap: 8px;
  min-width: 0;
}
.facts dt {
  flex: 0 0 auto;
  margin: 0;
  color: var(--ink-3);
}
.facts dd {
  margin: 0;
  min-width: 0;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.meta {
  margin-top: 16px;
}
.meta dd {
  color: var(--ink-2);
}
.report-section {
  margin-top: 26px;
  break-inside: auto;
}
.report-section > h2 {
  margin: 0 0 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--rule);
  font-size: 16.5px;
  line-height: 1.4;
  counter-increment: section;
}
.report-section > h2::before {
  content: counter(section) '. ';
  color: var(--ink-3);
}
.report { counter-reset: section; }
h3 {
  margin: 0;
  font-size: 14.5px;
}
.subhead {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.subhead h3 {
  min-width: 0;
  overflow-wrap: anywhere;
}
.chip {
  display: inline-block;
  padding: 1px 9px;
  border: 1px solid var(--rule-2);
  border-radius: 999px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--ink-2);
  white-space: nowrap;
}
.chip.ok {
  color: var(--chip-ok);
  border-color: var(--chip-ok-bd);
  background: var(--chip-ok-bg);
}
.chip.warn {
  color: var(--chip-warn);
  border-color: var(--chip-warn-bd);
  background: var(--chip-warn-bg);
}
.chip.open {
  color: var(--chip-open);
  border-color: var(--chip-open-bd);
  background: var(--chip-open-bg);
}
.chip.neutral {
  color: var(--ink-2);
  background: #f5f8fb;
}
.mono {
  font-family: ui-monospace, 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
  font-variant-numeric: tabular-nums;
}
.dim {
  color: var(--ink-3);
}
.detail {
  display: block;
  font-size: 12px;
  color: var(--ink-3);
  overflow-wrap: anywhere;
}
.note {
  margin: 8px 0 0;
  padding: 8px 12px;
  border: 1px solid var(--rule);
  border-left: 3px solid var(--ink-3);
  border-radius: 6px;
  background: #f8fafc;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--ink-2);
  break-inside: avoid;
}
.note.warn {
  border-left-color: var(--chip-warn);
  background: var(--chip-warn-bg);
  color: var(--chip-warn);
}
.hint {
  margin: 6px 0;
  font-size: 12.5px;
  color: var(--ink-3);
}
.disclaimer {
  margin: 6px 0 0;
  font-size: 11.5px;
  color: var(--ink-3);
}

/* ---- tables ---- */
/* Wide tables scroll inside their section on narrow viewports instead of being
   clipped by the document's overflow-x: clip; print is unaffected (full width). */
.table-scroll {
  max-width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
table {
  width: 100%;
  margin: 10px 0 4px;
  border-collapse: collapse;
  font-size: 12.5px;
}
caption {
  margin-bottom: 4px;
  text-align: left;
  font-size: 12px;
  color: var(--ink-3);
}
th,
td {
  padding: 5px 9px;
  border: 1px solid var(--rule);
  text-align: left;
  vertical-align: top;
}
th {
  background: #f4f7fa;
  color: var(--ink-2);
  font-weight: 600;
  white-space: nowrap;
}
td {
  color: var(--ink);
  overflow-wrap: anywhere;
}
tbody tr {
  break-inside: avoid;
}
th.ttl {
  width: 42px;
  color: var(--ink-3);
}

/* ---- blocks that should stay on one page when small ---- */
.member-block,
.trace-block,
.snap-agent,
.precursor-block {
  margin-top: 16px;
  break-inside: avoid;
}
.member-block .facts,
.trace-block .facts {
  margin-top: 6px;
}
.rounds {
  margin-top: 8px;
}

/* ---- timeline ---- */
.timeline {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
}
.timeline li {
  display: grid;
  grid-template-columns: minmax(150px, auto) minmax(110px, auto) minmax(0, 1fr);
  gap: 10px;
  align-items: baseline;
  padding: 5px 0;
  border-bottom: 1px dashed var(--rule);
}
.timeline .ts {
  color: var(--ink-3);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.timeline .kind {
  font-size: 12px;
  font-weight: 600;
  color: #0b7cbf;
}
.timeline .msg {
  min-width: 0;
  color: var(--ink-2);
  overflow-wrap: anywhere;
}

/* ---- snapshot ---- */
.group-status {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  margin: 6px 0 0;
  padding: 0;
}
.group-status li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
}
.group-status .field {
  color: var(--ink-2);
}
.iface-list {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
}
.iface-list li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  font-size: 12.5px;
}
.agent-line {
  margin: 6px 0 0;
  font-size: 12.5px;
  color: var(--ink-2);
}
.agent-line .mono {
  margin-left: 6px;
  overflow-wrap: anywhere;
}

/* ---- footer ---- */
.report-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 22px;
  margin-top: 32px;
  padding-top: 12px;
  border-top: 1px solid var(--rule);
  font-size: 11.5px;
  color: var(--ink-3);
}

/* Narrow screens: the timeline's three fixed columns need more than a phone
   viewport once sheet padding is accounted for, and the document clips
   horizontal overflow — so stack the fields instead of letting the message
   column be pushed off-screen. Tables already scroll via .table-scroll. The
   body:not(.export-capture) guard exempts the brief PDF-capture window, which
   pins the report to the A4 desktop layout. */
@media (max-width: 640px) {
  body:not(.export-capture) .report {
    padding: 24px 18px 20px;
    border-radius: 10px;
  }
  body:not(.export-capture) .timeline li {
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
    padding-block: 4px;
  }
}

/* During PDF capture the tables must render fully: an overflow-x container
   would be captured WITH its scrollbar and clip whatever does not fit its
   visible box, silently dropping table content from the exported PDF. At A4
   width the report's tables wrap to fit, so the scroll is unneeded. */
body.export-capture .table-scroll {
  overflow: visible;
}

@media print {
  .toolbar {
    display: none;
  }
  .report-page {
    padding: 0;
    background: #fff;
  }
  .report {
    max-width: none;
    margin: 0;
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }
  :global(body) {
    background: #fff;
  }
  /* Toasts are global chrome mounted even on the bare report route; a live toast
     would overlay the exported PDF. */
  :global(.toast-host) {
    display: none;
  }
}

@page {
  size: A4;
  margin: 12mm 14mm;
}
</style>
