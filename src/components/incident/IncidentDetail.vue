<script setup lang="ts">
// Accessible incident detail drawer (ALERT-002 + INCIDENT-002 + DIAG-001). Owns
// its own data (incident + member fault signals, notification records, timeline,
// immutable snapshot, shared trace reports) and self-paced polling: it only polls while the snapshot is still
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
  type FaultSignal,
  type Fluctuation,
  type NotificationDelivery,
} from '../../api'
import { toDateLocale } from '../../i18n'
import { useIncidentLabels, severityTone } from '../../composables/useIncidentLabels'
import { useMetricMeta } from '../../composables/useMetricMeta'
import { usePolling } from '../../composables/usePolling'
import SnapshotSection from './SnapshotSection.vue'
import TraceCard from './TraceCard.vue'
import FluctuationsTable from '../FluctuationsTable.vue'
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
const notifications = ref<NotificationDelivery[]>([])
// Sub-threshold streaks this fault claimed as its precursors: the same target was
// already faltering before it failed outright. Often the most useful thing in the
// drawer, because "it had been flapping for half an hour" and "it died out of
// nowhere" call for different investigations.
const precursors = ref<Fluctuation[]>([])
// The server's full count for this incident, kept so a capped page is declared
// rather than presented as the complete evidence.
const precursorTotal = ref(0)
// Whether the notification records could be read at all. An empty list means
// "nothing was due to be sent", which is a legitimate and reassuring state; a
// failed request must not borrow that wording and tell the operator no channel
// was notified when the truth is that we do not know.
const notifyFailed = ref(false)
const loaded = ref(false)
const error = ref('')

const incident = computed(() => detail.value?.incident ?? null)
const members = computed(() => detail.value?.members ?? [])
// Count of distinct targets STILL failing right now — computed server-side from
// live detector state, deliberately not derived from the member count, whose
// evidence is immutable.
const abnormalTargetCount = computed(() => detail.value?.abnormal_target_count ?? 0)
const titleId = 'incident-detail-title'

const fmtDateTime = (s: string | null) =>
  s ? new Date(s).toLocaleString(toDateLocale(locale.value), { hour12: false }) : '—'
const fmtNum = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2))

// A member ended by a configuration change is shown as a distinct "terminated"
// state, never mixed with a genuine recovery: the fault did not go away, it
// stopped being observable.
const memberStateKey = (m: FaultSignal) => {
  if (m.state === 'firing') return 'firing'
  return m.resolve_reason && m.resolve_reason !== 'recovered' ? 'terminated' : 'resolved'
}
const memberStateLabel = (m: FaultSignal) => t(`incidents.detail.memberState.${memberStateKey(m)}`)

// How long the detector took to confirm — the gap between the first failing round
// and the threshold being met. Shown beside the timestamps so a slow confirmation
// is visible rather than mistaken for a slow fault.
function confirmLag(m: FaultSignal): string {
  const secs = Math.max(
    0,
    Math.round((new Date(m.confirmed_at).getTime() - new Date(m.observed_at).getTime()) / 1000),
  )
  return t('incidents.detail.confirmLagValue', { n: secs })
}

// A delivery's status in words. "canceled" is not a failure: it is what happens
// when a fault recovers inside its notification delay, which is the delay doing
// exactly what it exists for.
const deliveryLabel = (d: NotificationDelivery) => t(`incidents.detail.delivery.${d.status}`)
const deliveryTone = (d: NotificationDelivery) =>
  d.status === 'sent' ? 'ok' : d.status === 'failed' ? 'warn' : 'neutral'

// ---- data + self-paced polling ----

// How long to wait before looking again when the only outstanding work is a
// delivery serving out its notification delay. Returns false when nothing is
// pending. The small settle margin absorbs clock skew between browser and server
// and gives the delivery worker (3s cadence) a tick to actually send.
const NOTIFY_SETTLE_MS = 4000
function nextDeliveryDelay(notes: NotificationDelivery[]): boolean | number {
  const due = notes.filter((n) => n.status === 'pending').map((n) => new Date(n.due_at).getTime())
  if (!due.length) return false
  return Math.max(NOTIFY_SETTLE_MS, Math.min(...due) - Date.now() + NOTIFY_SETTLE_MS)
}

async function load(): Promise<boolean | number> {
  const id = props.incidentId
  try {
    const [d, tl, snap, sums, notes, pre] = await Promise.all([
      api.incident(id),
      api.timeline(id),
      api.incidentSnapshot(id),
      api.incidentTraces(id),
      // Kept out of the failure path of the drawer as a whole — the fault itself
      // is still worth showing — but the failure is recorded, not erased.
      api.incidentNotifications(id).catch(() => null),
      // Same reasoning: precursors are context, not the incident itself. 500 is the
      // server's maximum page; a merged group incident can accumulate precursors from
      // every member, and evidence that is silently cut off is worse than none.
      api.fluctuations({ incident: id, limit: 500 }).catch(() => null),
    ])
    if (id !== props.incidentId) return false // selection changed mid-flight
    detail.value = d
    timeline.value = tl
    snapshot.value = snap
    notifyFailed.value = notes === null
    notifications.value = notes ?? []
    precursors.value = pre?.items ?? []
    precursorTotal.value = pre?.total ?? 0
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
    if (snapActive || traceActive) return true
    // A pending delivery is live work too — the drawer should show it flip to
    // "sent" rather than looking stuck — but a notification delay is minutes,
    // not seconds. Sleep until just after the earliest one comes due instead of
    // re-fetching the whole drawer every 4s for an answer that cannot change yet.
    return nextDeliveryDelay(notes ?? [])
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

        <!-- Member fault signals with their frozen evidence. -->
        <section class="block" aria-labelledby="mem-h">
          <h4 id="mem-h">{{ t('incidents.detail.memberFaults') }}</h4>
          <p v-if="!members.length" class="hint">{{ t('incidents.detail.noMembers') }}</p>
          <div v-for="m in members" :key="m.id" class="card sub">
            <div class="member-head">
              <b>{{ m.title || (locale === 'en' ? m.desc_en : m.desc_zh) || m.target_name || m.target_addr }}</b>
              <span class="badge" :class="m.state === 'firing' ? 'open' : memberStateKey(m) === 'terminated' ? 'warn' : 'resolved'">
                {{ memberStateLabel(m) }}
              </span>
              <span class="badge" :class="severityTone(m.severity)">{{ sevLabel(m.severity) }}</span>
              <span
                v-if="m.state === 'firing' && !m.currently_abnormal"
                class="badge neutral tiny"
                :title="t('incidents.detail.recoveringHint')"
              >{{ t('incidents.detail.recovering') }}</span>
              <span class="hint agent-name">
                <span
                  v-if="presenceOf(m.agent_id)"
                  class="presence-dot"
                  :class="presenceOf(m.agent_id)"
                  :title="presenceOf(m.agent_id) === 'online' ? t('agents.statusOnline') : t('agents.statusOffline')"
                ></span>
                {{ m.agent_name || m.agent_id }}
              </span>
            </div>
            <dl class="facts member-facts">
              <div v-if="m.target_addr">
                <dt>{{ t('incidents.detail.evTarget') }}</dt>
                <dd class="mono">{{ m.target_addr }}</dd>
              </div>
              <div v-if="m.metric_kind">
                <dt>{{ t('incidents.detail.evMetric') }}</dt>
                <dd>
                  {{ metricLabel(m.metric_kind) }}
                  <span class="mono">{{ fmtNum(m.value) }}</span>
                  <span class="hint">
                    (<span :aria-label="comparatorLabel(m.comparator)">{{ comparatorSymbol(m.comparator) }}</span>
                    {{ fmtNum(m.threshold) }})
                  </span>
                </dd>
              </div>
              <div v-if="m.reason_code > 0">
                <dt>{{ t('incidents.detail.evReason') }}</dt>
                <dd>
                  <span class="reason-chip">{{ probeReasonLabel(m.reason_code) }}</span>
                  <span v-if="m.reason_detail" class="hint mono ev-detail" :title="m.reason_detail">{{ m.reason_detail }}</span>
                </dd>
              </div>
              <div>
                <dt>{{ t('incidents.detail.evObserved') }}</dt>
                <dd class="hint">{{ fmtDateTime(m.observed_at) }}</dd>
              </div>
              <div>
                <dt>{{ t('incidents.detail.evConfirmed') }}</dt>
                <dd class="hint">
                  {{ fmtDateTime(m.confirmed_at) }}
                  <span class="hint">({{ t('incidents.detail.confirmLag') }} {{ confirmLag(m) }})</span>
                </dd>
              </div>
              <div v-if="m.resolved_at">
                <dt>{{ t('incidents.detail.evResolved') }}</dt>
                <dd class="hint">{{ fmtDateTime(m.resolved_at) }}</dd>
              </div>
              <div>
                <dt>{{ t('incidents.detail.evSensitivity') }}</dt>
                <dd class="hint">
                  {{ t('incidents.detail.sensitivityValue', { fail: m.fail_threshold, recover: m.recover_threshold }) }}
                </dd>
              </div>
              <div v-if="m.resolve_reason">
                <dt>{{ t('incidents.detail.endReason') }}</dt>
                <dd>
                  <span class="badge tiny" :class="m.resolve_reason === 'recovered' ? 'ok' : 'warn'">
                    {{ resolveReasonLabel(m.resolve_reason) }}
                  </span>
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <!-- What was actually sent, to where and when — or why nothing was. -->
        <section class="block" aria-labelledby="notify-h">
          <h4 id="notify-h">{{ t('incidents.detail.notifications') }}</h4>
          <p v-if="notifyFailed" class="hint warn-text">{{ t('incidents.detail.ntUnavailable') }}</p>
          <p v-else-if="!notifications.length" class="hint">
            {{ t('incidents.detail.noNotifications') }}
          </p>
          <div v-if="notifications.length" class="table-scroll">
            <table class="mini-table">
              <thead>
                <tr>
                  <th>{{ t('incidents.detail.ntEvent') }}</th>
                  <th>{{ t('incidents.detail.ntChannel') }}</th>
                  <th>{{ t('incidents.detail.ntStatus') }}</th>
                  <th>{{ t('incidents.detail.ntDue') }}</th>
                  <th>{{ t('incidents.detail.ntSent') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="n in notifications" :key="n.id">
                  <td>{{ t(`incidents.detail.ntKind.${n.event_kind}`) }}</td>
                  <td>{{ n.channel_name || n.channel_id }}</td>
                  <td><span class="badge tiny" :class="deliveryTone(n)">{{ deliveryLabel(n) }}</span></td>
                  <td class="hint">{{ fmtDateTime(n.due_at) }}</td>
                  <td class="hint">{{ fmtDateTime(n.sent_at ?? null) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- Precursors: this target's sub-threshold streaks in the hour before the
             fault confirmed. Rendered only when there were any — an absence is not
             a finding worth a heading. -->
        <section v-if="precursors.length" class="block" aria-labelledby="pre-h">
          <h4 id="pre-h">{{ t('incidents.precursors.title') }}</h4>
          <p class="hint">{{ t('incidents.precursors.sub') }}</p>
          <FluctuationsTable
            :items="precursors"
            show-agent
            :total="precursorTotal > precursors.length ? precursorTotal : undefined"
          />
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
/* A member's frozen evidence reads as label/value pairs rather than a one-row
   table: a built-in detector reaches its verdict from a single metric, so there
   is nothing to tabulate. */
.member-facts {
  margin: 0;
  gap: 6px 26px;
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
  color: var(--color-danger-text);
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
  color: var(--color-danger-text);
  border: 1px solid rgba(248, 113, 113, 0.4);
  background: rgba(248, 113, 113, 0.1);
  white-space: nowrap;
}
/* Raw underlying error under the reason chip (verbatim machine text, never
   localized) — ellipsized on one line so a long dial error can't blow the
   column out; the full text is in the hover title. */
.ev-detail {
  display: block;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
}
.table-scroll {
  overflow-x: auto;
}
/* "We could not read this" must not look like the calm "nothing to report". */
.warn-text {
  color: var(--color-warning-text);
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
  color: var(--color-accent-text);
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
