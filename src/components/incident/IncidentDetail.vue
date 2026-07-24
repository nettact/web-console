<script setup lang="ts">
// Accessible incident detail drawer (INCIDENT-001/002 + DIAG-001). Owns its own
// data (incident + member alerts, timeline, immutable snapshot, shared trace
// reports) and self-paced polling: it only polls while the snapshot is still
// collecting or a referenced trace report is queued/running, via the reusable
// usePolling composable (single in-flight request, cleanup on unmount). Dialog
// semantics: role=dialog / aria-modal, focus moved in on open, Tab trapped,
// Escape closes and focus is restored to the triggering element on unmount. The
// component is keyed by incident id in the parent, so switching incidents tears
// this instance down and late responses land on the discarded instance.
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  api,
  type IncidentDetail,
  type TimelineEntry,
  type SnapshotView,
  type TraceReportView,
  type Alert,
} from '../../api'
import { toDateLocale } from '../../i18n'
import { useIncidentLabels, severityTone } from '../../composables/useIncidentLabels'
import { useMetricMeta } from '../../composables/useMetricMeta'
import { usePolling } from '../../composables/usePolling'
import SnapshotSection from './SnapshotSection.vue'
import TraceCard from './TraceCard.vue'
import { agentIndex } from '../../agentStatus'

const props = defineProps<{ incidentId: string }>()
const emit = defineEmits<{ close: [] }>()

const { t, locale } = useI18n()

// A member agent's live presence (online/offline) from the shared agent-status
// store, so the incident view shows the same liveness as the Agent list.
function presenceOf(agentId: string): 'online' | 'offline' | '' {
  const row = agentIndex.value.get(agentId)
  if (!row) return ''
  return row.presence === 'online' ? 'online' : 'offline'
}
const { sevLabel, layerLabel, kindLabel, resolveReasonLabel, comparatorSymbol, comparatorLabel } =
  useIncidentLabels()
const { metricLabel, probeReasonLabel } = useMetricMeta()

const detail = ref<IncidentDetail | null>(null)
const timeline = ref<TimelineEntry[]>([])
const snapshot = ref<SnapshotView | null>(null)
const traces = ref<TraceReportView[]>([])
const loaded = ref(false)
const error = ref('')

const incident = computed(() => detail.value?.incident ?? null)
const members = computed(() => detail.value?.members ?? [])
// Count of distinct targets STILL currently abnormal on this incident's firing
// alerts — computed server-side from current condition state, deliberately not
// derived from the immutable evidence count.
const abnormalTargetCount = computed(() => detail.value?.abnormal_target_count ?? 0)
const titleId = 'incident-detail-title'

const fmtDateTime = (s: string | null) =>
  s ? new Date(s).toLocaleString(toDateLocale(locale.value), { hour12: false }) : '—'
const fmtNum = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2))

// A member alert resolved by a configuration change is shown as a distinct
// "terminated" state, never mixed with a genuine recovery.
const memberStateKey = (a: Alert) => {
  if (a.state === 'firing') return 'firing'
  return a.resolve_reason === 'configuration_changed' ? 'terminated' : 'resolved'
}
const memberStateLabel = (a: Alert) => t(`incidents.detail.memberState.${memberStateKey(a)}`)

// ---- data + self-paced polling ----
async function load(): Promise<boolean> {
  const id = props.incidentId
  try {
    const [d, tl, snap, sums] = await Promise.all([
      api.incident(id),
      api.timeline(id),
      api.incidentSnapshot(id),
      api.incidentTraces(id),
    ])
    if (id !== props.incidentId) return false // selection changed mid-flight
    detail.value = d
    timeline.value = tl
    snapshot.value = snap
    const reports = await Promise.all(
      sums.map((s) => api.traceReport(s.report_id).catch(() => null)),
    )
    if (id !== props.incidentId) return false
    traces.value = reports.filter((r): r is TraceReportView => !!r)
    loaded.value = true
    error.value = ''
    // Keep polling only while there is live work to observe.
    const snapActive = snap?.status === 'collecting'
    const traceActive = sums.some((s) => s.status === 'queued' || s.status === 'running')
    return snapActive || traceActive
  } catch (e) {
    error.value = String((e as Error).message || e)
    throw e // let the poller back off and retry
  }
}
const poller = usePolling(load, { intervalMs: 4000 })

// ---- focus management / trap ----
const dialog = ref<HTMLElement | null>(null)
const closeBtn = ref<HTMLButtonElement | null>(null)
let lastFocused: HTMLElement | null = null

function focusable(): HTMLElement[] {
  if (!dialog.value) return []
  return Array.from(
    dialog.value.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.offsetParent !== null || el === document.activeElement)
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
    return
  }
  if (e.key !== 'Tab') return
  const f = focusable()
  if (!f.length) return
  const first = f[0]
  const last = f[f.length - 1]
  const active = document.activeElement as HTMLElement | null
  if (!dialog.value?.contains(active)) {
    e.preventDefault()
    first.focus()
  } else if (e.shiftKey && active === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
  }
}

onMounted(() => {
  lastFocused = document.activeElement as HTMLElement | null
  window.addEventListener('keydown', onKeydown, true)
  nextTick(() => closeBtn.value?.focus())
  poller.start()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
  poller.stop()
  lastFocused?.focus?.()
})
</script>

<template>
  <div class="drawer-backdrop" @click="emit('close')"></div>
  <aside
    ref="dialog"
    class="drawer"
    role="dialog"
    aria-modal="true"
    :aria-labelledby="titleId"
    @click.stop
  >
    <div class="drawer-head">
      <div class="drawer-title">
        <h3 :id="titleId">{{ t('incidents.detail.title') }}</h3>
        <p v-if="incident" class="drawer-sub">{{ incident.summary || incident.title }}</p>
      </div>
      <button ref="closeBtn" class="drawer-close" @click="emit('close')" :aria-label="t('common.close')">
        ×
      </button>
    </div>

    <div class="drawer-body">
      <p v-if="error" class="err">{{ error }}</p>
      <p v-if="!loaded && !error" class="hint">{{ t('common.noData') }}</p>

      <template v-if="incident">
        <!-- Header facts. State is text + badge (never colour alone). -->
        <div class="head-facts">
          <span class="badge" :class="incident.state === 'open' ? 'open' : 'resolved'">
            <span class="dot" :class="incident.state === 'open' ? 'down' : 'up'"></span>
            {{ incident.state === 'open' ? t('incidents.stateOpen') : t('incidents.stateResolved') }}
          </span>
          <span class="badge" :class="severityTone(incident.severity)">{{ sevLabel(incident.severity) }}</span>
          <span class="pill">{{ t('incidents.detail.group') }}: {{ incident.group_name || '—' }}</span>
          <span class="pill">{{ layerLabel(incident.suspected_layer) }}</span>
          <span class="pill">
            {{ t('incidents.detail.relatedAlerts', { active: incident.active_member_count, total: incident.member_count }) }}
          </span>
          <span class="pill" :class="{ abnormal: abnormalTargetCount > 0 }">
            {{ t('incidents.detail.abnormalTargets', { n: abnormalTargetCount }) }}
          </span>
        </div>
        <dl class="facts">
          <div><dt>{{ t('incidents.detail.openedAt') }}</dt><dd>{{ fmtDateTime(incident.opened_at) }}</dd></div>
          <div v-if="incident.resolved_at">
            <dt>{{ t('incidents.detail.resolvedAt') }}</dt><dd>{{ fmtDateTime(incident.resolved_at) }}</dd>
          </div>
          <div v-if="incident.state === 'resolved' && incident.resolve_reason">
            <dt>{{ t('incidents.detail.endReason') }}</dt>
            <dd>
              <span
                class="badge"
                :class="incident.resolve_reason === 'configuration_changed' ? 'warn' : 'ok'"
              >{{ resolveReasonLabel(incident.resolve_reason) }}</span>
            </dd>
          </div>
        </dl>
        <p v-if="incident.evidence_expired" class="notice" role="note">
          {{ t('incidents.detail.evidenceExpired') }}
        </p>

        <!-- Member alerts + per-condition evidence. -->
        <section class="block" aria-labelledby="mem-h">
          <h4 id="mem-h">{{ t('incidents.detail.memberAlerts') }}</h4>
          <p v-if="!members.length" class="hint">{{ t('incidents.detail.noMembers') }}</p>
          <div v-for="m in members" :key="m.id" class="card sub">
            <div class="member-head">
              <b>{{ m.rule_name }}</b>
              <span class="badge" :class="m.state === 'firing' ? 'open' : memberStateKey(m) === 'terminated' ? 'warn' : 'resolved'">
                {{ memberStateLabel(m) }}
              </span>
              <span class="badge" :class="severityTone(m.severity)">{{ sevLabel(m.severity) }}</span>
              <span class="hint agent-name">
                <span
                  v-if="presenceOf(m.agent_id)"
                  class="presence-dot"
                  :class="presenceOf(m.agent_id)"
                  :title="presenceOf(m.agent_id) === 'online' ? t('agents.statusOnline') : t('agents.statusOffline')"
                ></span>
                {{ m.agent_host || m.agent_id }}
              </span>
            </div>
            <div class="table-scroll">
              <table class="mini-table">
                <thead>
                  <tr>
                    <th>{{ t('incidents.detail.evTarget') }}</th>
                    <th>{{ t('incidents.detail.evAgent') }}</th>
                    <th>{{ t('incidents.detail.evMetric') }}</th>
                    <th>{{ t('incidents.detail.evValue') }}</th>
                    <th>{{ t('incidents.detail.evThreshold') }}</th>
                    <th>{{ t('incidents.detail.evObserved') }}</th>
                    <th>{{ t('incidents.detail.evState') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="!m.evidence.length"><td colspan="7" class="hint">{{ t('incidents.detail.noEvidence') }}</td></tr>
                  <tr v-for="ev in m.evidence" :key="ev.id">
                    <td class="ev-target">
                      <span class="mono ev-name">{{ ev.target_name || ev.target_addr || ev.target_id }}</span>
                      <span v-if="ev.target_name && ev.target_addr" class="hint mono ev-addr">{{ ev.target_addr }}</span>
                    </td>
                    <td class="hint">{{ m.agent_host || m.agent_id }}</td>
                    <td>
                      {{ metricLabel(ev.metric_kind) }}
                      <span v-if="ev.reason_code > 0" class="reason-chip">{{ probeReasonLabel(ev.reason_code) }}</span>
                    </td>
                    <td class="num mono">{{ fmtNum(ev.value) }}</td>
                    <td class="num mono">
                      <span :aria-label="comparatorLabel(ev.comparator)">{{ comparatorSymbol(ev.comparator) }}</span>
                      {{ fmtNum(ev.threshold) }}
                    </td>
                    <td class="hint">{{ fmtDateTime(ev.observed_at) }}</td>
                    <td>
                      <span class="badge tiny" :class="ev.currently_abnormal ? 'open' : 'neutral'">
                        {{ ev.currently_abnormal ? t('incidents.detail.evCurrent') : t('incidents.detail.evHistorical') }}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <!-- Immutable snapshot. -->
        <SnapshotSection :snapshot="snapshot" :evidence-expired="incident.evidence_expired" />

        <!-- Path diagnostics: one card per referenced shared report. -->
        <section class="block" aria-labelledby="trace-h">
          <h4 id="trace-h">{{ t('incidents.trace.title') }}</h4>
          <p class="hint">{{ t('incidents.trace.sub') }}</p>
          <p v-if="!traces.length" class="hint">{{ t('incidents.trace.none') }}</p>
          <TraceCard v-for="r in traces" :key="r.report_id" :report="r" />
        </section>

        <!-- Timeline: localized kinds + entity refs. -->
        <section class="block" aria-labelledby="tl-h">
          <h4 id="tl-h">{{ t('incidents.timeline') }}</h4>
          <ul class="timeline">
            <li v-if="!timeline.length" class="hint">{{ t('incidents.noRecords') }}</li>
            <li v-for="(entry, idx) in timeline" :key="idx">
              <span class="node"></span>
              <span class="ts">{{ fmtDateTime(entry.ts) }}</span>
              <span class="kind">{{ kindLabel(entry.kind) }}</span>
              <span class="msg">{{ entry.message }}</span>
              <code v-if="entry.ref" class="ref" :title="entry.ref">{{ entry.ref }}</code>
            </li>
          </ul>
        </section>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.drawer-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 90;
}
.drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(940px, 96vw);
  background: var(--surface-solid);
  border-left: 1px solid var(--border);
  box-shadow: -10px 0 34px rgba(0, 0, 0, 0.32);
  z-index: 100;
  display: flex;
  flex-direction: column;
}
.drawer-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border);
}
.drawer-title h3 {
  font-size: 15px;
}
.drawer-sub {
  margin-top: 5px;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--text-dim);
}
.drawer-close {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
  padding: 0 2px;
}
.drawer-close:hover {
  color: var(--text);
}
.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px 40px;
}
.head-facts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 22px;
  margin: 6px 0 10px;
}
.facts > div {
  display: flex;
  gap: 8px;
  font-size: 12.5px;
}
.facts dt {
  margin: 0;
  color: var(--text-muted);
}
.facts dd {
  /* Reset the browser's default 40px dd indent, which otherwise stacks on top of
     the flex gap and pushes each value far from its label. */
  margin: 0;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.block {
  margin-top: 20px;
}
.block > h4 {
  font-size: 14px;
  margin-bottom: 8px;
}
.card.sub {
  padding: 12px 14px;
  margin: 10px 0;
}
.member-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.agent-name {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.presence-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}
.presence-dot.online {
  background: #34d399;
}
.presence-dot.offline {
  background: #f87171;
}
.pill.abnormal {
  color: var(--danger);
  border-color: rgba(248, 113, 113, 0.4);
  background: var(--danger-soft);
}
.badge.tiny {
  padding: 1px 7px;
  font-size: 10.5px;
}
/* Frozen probe failure reason ("network unreachable" / "DNS resolution failed"),
   shown beside the metric so the operator sees WHY, not just the breached value. */
.reason-chip {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10.5px;
  color: #fca5a5;
  border: 1px solid rgba(248, 113, 113, 0.4);
  background: rgba(248, 113, 113, 0.1);
  white-space: nowrap;
}
.table-scroll {
  overflow-x: auto;
}
.mini-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.mini-table th,
.mini-table td {
  text-align: left;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
  /* Keep headers and short values on one line so narrow columns can't collapse
     into single-character vertical wrapping; the target column opts back out. */
  white-space: nowrap;
}
.mini-table th {
  color: var(--text-muted);
  font-weight: 600;
}
.mini-table td.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
/* The target holds a full URL — let it wrap within a bounded column instead of
   hogging width and squeezing every other column. */
.mini-table td.ev-target {
  white-space: normal;
  word-break: break-all;
  min-width: 220px;
}
/* Stack the name and address on separate lines so the URL starts at the cell's
   left edge and every wrapped line stays column-aligned (an inline " · addr"
   would start mid-line and wrap its tail back under the name). */
.ev-target .ev-name,
.ev-target .ev-addr {
  display: block;
}
.notice {
  font-size: 12.5px;
  color: var(--text-dim);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 7px 11px;
  margin: 8px 0;
}
.timeline {
  list-style: none;
  margin: 0;
  padding: 6px 4px;
}
.timeline li {
  display: flex;
  align-items: baseline;
  gap: 12px;
  position: relative;
  padding: 9px 0 9px 20px;
}
.timeline li:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 20px;
  bottom: -4px;
  width: 1px;
  background: var(--border-strong);
}
.timeline .node {
  position: absolute;
  left: 0;
  top: 12px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--primary);
  box-shadow: 0 0 8px var(--primary-glow);
}
.timeline .ts {
  flex: 0 0 auto;
  color: var(--text-muted);
  min-width: 120px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.timeline .kind {
  flex: 0 0 auto;
  font-size: 12px;
  min-width: 120px;
  color: var(--primary);
}
.timeline .msg {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--text-dim);
  word-break: break-word;
}
.timeline .ref {
  flex: 0 0 auto;
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--text-muted);
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 560px) {
  .timeline li {
    flex-wrap: wrap;
  }
}
</style>
