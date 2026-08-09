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
import { useRouter } from 'vue-router'
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
import { isDegradation, isHostDetector } from '../../lib/detection'
import { useIncidentLabels, severityTone } from '../../composables/useIncidentLabels'
import { useMetricMeta } from '../../composables/useMetricMeta'
import { usePolling } from '../../composables/usePolling'
import { openEventStream } from '../../lib/sse'
import SnapshotSection from './SnapshotSection.vue'
import TraceCard from './TraceCard.vue'
import FluctuationsTable from '../FluctuationsTable.vue'
import { agentIndex } from '../../agentStatus'

const props = defineProps<{ incidentId: string }>()
const emit = defineEmits<{ close: [] }>()

const router = useRouter()
const { t, locale } = useI18n()

// INCIDENT-004: the report is its own bare route (a print document), so exporting
// navigates there rather than printing the drawer.
function openReport() {
  router.push(`/incidents/${props.incidentId}/report`)
}

// A member agent's live presence (online/offline) from the shared agent-status
// store, so the incident view shows the same liveness as the Agent list.
function presenceOf(agentId: string): 'online' | 'offline' | '' {
  const row = agentIndex.value.get(agentId)
  if (!row) return ''
  return row.presence === 'online' ? 'online' : 'offline'
}
const {
  sevLabel,
  layerLabel,
  kindLabel,
  resolveReasonLabel,
  comparatorSymbol,
  comparatorLabel,
  detectorLabel,
  attributionSentence,
  clueLabel,
  cluePolarity,
} = useIncidentLabels()
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
// The typed evidence behind the incident's attribution sentence, if any.
const attrClues = computed(() => incident.value?.attribution_evidence ?? [])
// A short "here is the sentence" — empty means no attribution, so the drawer
// falls back to the layer pill and only shows the advisory when evidence is thin.
const attributionLine = computed(() =>
  incident.value ? attributionSentence(incident.value.attribution ?? '', attrClues.value) : '',
)
// The advisory hint is shown only when the evidence itself says it would help
// (no gateway or reference target to compare) and the fault is still open.
const showAttributionHint = computed(
  () =>
    incident.value?.state === 'open' &&
    !attributionLine.value &&
    attrClues.value.some((c) => c.kind === 'no_reference'),
)
// Count of distinct targets STILL failing right now — computed server-side from
// live detector state, deliberately not derived from the member count, whose
// evidence is immutable.
const abnormalTargetCount = computed(() => detail.value?.abnormal_target_count ?? 0)
const titleId = 'incident-detail-title'
const summaryId = 'incident-detail-summary'

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
    // Keep polling only while there is live work to observe. Traceroute is not
    // live work any more: the Agent runs it on its own and a report only exists
    // once it is finished and uploaded, so there is no in-progress state to watch
    // — a report that has not arrived yet arrives with the next telemetry packet.
    if (snap?.status === 'collecting') return true
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
let offIncidentSSE: (() => void) | undefined

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
  // INCIDENT-003: the drawer's poller goes idle once nothing is collecting, but a
  // sibling confirm/resolve on the same Agent or a landing trace can still change
  // THIS incident's attribution (the server broadcasts incident.changed for it).
  // Restart the poller so the conclusion does not sit stale until the drawer is
  // reopened; onOpen converges after a reconnect, which does not replay the
  // missed event. All refreshes go through the poller's single-flight, so a
  // start() that races an in-flight tick is queued rather than dropped, and the
  // stream is closed on unmount so nothing can restart the loop afterwards.
  const stream = openEventStream({
    onOpen: () => poller.start(),
    onIncident: (ev) => {
      if (ev.incident_id && ev.incident_id === props.incidentId) poller.start()
    },
  })
  offIncidentSSE = () => stream.close()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
  poller.stop()
  offIncidentSSE?.()
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
    :aria-describedby="incident ? summaryId : undefined"
    :aria-busy="!loaded && !error"
    @click.stop
  >
    <div class="drawer-head">
      <div class="drawer-title">
        <h3 :id="titleId">{{ t('incidents.detail.title') }}</h3>
        <p v-if="incident" :id="summaryId" class="drawer-sub">
          {{ incident.summary || incident.title }}
        </p>
      </div>
      <div class="drawer-actions">
        <button type="button" class="drawer-action" @click="openReport">
          {{ t('incidents.report.exportPdf') }}
        </button>
        <button ref="closeBtn" class="drawer-close" @click="emit('close')" :aria-label="t('common.close')">
          ×
        </button>
      </div>
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
        <!-- INCIDENT-003: the one-line "where is the problem most likely" with its
             evidence. Always visible when an attribution exists; every conclusion
             ships its ✓/✗ clues, never a bare claim. -->
        <div v-if="attributionLine" class="attribution" role="note">
          <p class="attribution-sentence">{{ attributionLine }}</p>
          <ul class="attribution-clues">
            <li
              v-for="(c, i) in attrClues"
              :key="c.kind + '-' + i"
              class="clue"
              :class="cluePolarity(c.kind)"
            >{{ clueLabel(c) }}</li>
          </ul>
        </div>
        <p v-else-if="showAttributionHint" class="notice" role="note">
          {{ t('incidents.attribution.advisory.no_reference') }}
        </p>
        <dl class="facts">
          <div>
            <dt>{{ t('incidents.detail.firstObservedAt') }}</dt>
            <dd>{{ fmtDateTime(incident.first_observed_at) }}</dd>
          </div>
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
              <!-- Degradation members are labelled explicitly. Severity alone does
                   not carry it: "info" says how loud this is, not that the target
                   is answering fine and merely doing so slowly.
                   System-status members are labelled for a different reason: one
                   of four disks being full is only legible if the chip names which
                   one, and "system status" among network members needs saying. -->
              <span
                v-if="isDegradation(m.detector_key) || isHostDetector(m.detector_key)"
                class="badge neutral tiny"
              >{{ detectorLabel(m.detector_key) }}</span>
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
              <!-- A baseline-judged member reads as a sentence, not as a
                   comparison against a number. "≥ 67.5" is a threshold the
                   product derived from this target's own history; nobody chose
                   it and nobody would recognise it, so what is shown is the
                   comparison that was actually made. -->
              <div v-if="m.metric_kind && isDegradation(m.detector_key)">
                <dt>{{ t('incidents.detail.evVsBaseline') }}</dt>
                <dd>
                  {{ metricLabel(m.metric_kind) }}
                  <span class="mono">{{ fmtNum(m.value) }}</span>
                  <span class="hint">
                    {{ t('incidents.detail.baselineUsual', { usual: fmtNum(m.baseline_p50) }) }}
                  </span>
                </dd>
              </div>
              <div v-else-if="m.metric_kind">
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
              <div v-if="m.reason_code > 0" class="fact-reason">
                <dt>{{ t('incidents.detail.evReason') }}</dt>
                <dd class="reason-value">
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
              <div class="fact-sensitivity">
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
/* Hallmark · component: wide incident modal · genre: custom application
 * theme: NetTact Liquid Glass · design-system: design.md
 * states: open · loading · error · loaded · focus · active · responsive · reduced-motion
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 */
.drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: var(--color-backdrop);
  backdrop-filter: blur(var(--space-3xs));
  -webkit-backdrop-filter: blur(var(--space-3xs));
  animation: incident-backdrop-in var(--dur-short) var(--ease-out) both;
}
.drawer {
  position: fixed;
  inset: var(--space-md);
  z-index: calc(var(--z-modal) + 1);
  display: flex;
  flex-direction: column;
  width: auto;
  max-width: 1440px;
  margin-inline: auto;
  overflow: hidden;
  border: var(--rule-hair) solid var(--glass-border);
  border-radius: var(--radius-panel);
  background: var(--color-glass-strong);
  box-shadow: var(--shadow-float);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  animation: incident-modal-in var(--dur-long) var(--ease-out) both;
}
.drawer-head {
  display: flex;
  flex: 0 0 auto;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-sm) var(--space-md);
  border-bottom: var(--rule-hair) solid var(--color-rule);
  background: var(--color-glass);
}
.drawer-title {
  min-width: 0;
}
.drawer-title h3 {
  font-family: var(--font-display);
  font-size: var(--text-lg);
  line-height: 1.2;
  letter-spacing: -0.028em;
}
.drawer-sub {
  max-width: 100ch;
  margin-top: var(--space-2xs);
  color: var(--color-ink-2);
  font-size: var(--text-sm);
  line-height: 1.55;
  overflow-wrap: anywhere;
}
.drawer-close {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-input);
  background: var(--color-glass-subtle);
  color: var(--color-muted);
  font-size: var(--text-xl);
  line-height: 1;
  cursor: pointer;
  transition: transform var(--dur-micro) var(--ease-out);
}
.drawer-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-2xs);
}
/* INCIDENT-004: the report entry. Sits beside the close button in the drawer
   head; navigating to the report's bare route tears the drawer down. */
.drawer-action {
  min-height: 44px;
  padding: var(--space-2xs) var(--space-sm);
  border: var(--rule-hair) solid var(--color-rule-2);
  border-radius: var(--radius-input);
  background: var(--color-glass-subtle);
  color: var(--color-accent-text);
  font-size: var(--text-xs);
  font-weight: 650;
  cursor: pointer;
  white-space: nowrap;
  transition: transform var(--dur-micro) var(--ease-out), border-color var(--dur-micro) var(--ease-out);
}
.drawer-action:hover,
.drawer-action:focus-visible {
  border-color: var(--color-accent);
}
.drawer-action:active {
  transform: translateY(1px);
}
.drawer-close:focus-visible {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: var(--space-3xs);
}
.drawer-close:active {
  transform: translateY(1px);
}
.drawer-close:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.drawer-body {
  flex: 1 1 auto;
  min-height: 0;
  padding: var(--space-md) var(--space-lg) var(--space-xl);
  overflow-x: clip;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  background: var(--surface-solid);
}
.drawer-body > * {
  width: 100%;
  max-width: 1320px;
  margin-inline: auto;
}
.head-facts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2xs);
  margin-bottom: var(--space-xs);
}
.facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-2xs) var(--space-lg);
  margin: var(--space-2xs) 0 var(--space-sm);
}
.facts > div {
  display: flex;
  min-width: 0;
  gap: var(--space-2xs);
  font-size: var(--text-sm);
}
.facts dt {
  flex: 0 0 auto;
  margin: 0;
  color: var(--color-muted);
}
.facts dd {
  /* Reset the browser's default 40px dd indent, which otherwise stacks on top of
     the flex gap and pushes each value far from its label. */
  margin: 0;
  min-width: 0;
  color: var(--color-ink-2);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.block {
  margin-top: var(--space-lg);
}
.block > h4 {
  margin-bottom: var(--space-xs);
  font-family: var(--font-display);
  font-size: var(--text-md);
  line-height: 1.3;
}
.card.sub {
  margin: var(--space-xs) 0;
  padding: var(--space-sm) var(--space-md);
}
.member-head {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  margin-bottom: var(--space-xs);
}
.member-head > b {
  min-width: 0;
  overflow-wrap: anywhere;
}
/* A member's frozen evidence reads as label/value pairs rather than a one-row
   table: a built-in detector reaches its verdict from a single metric, so there
   is nothing to tabulate. */
.member-facts {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 0;
  gap: 0 var(--space-lg);
}
.member-facts > div {
  display: grid;
  align-content: start;
  gap: var(--space-3xs);
  padding-block: var(--space-xs);
  border-top: var(--rule-hair) solid var(--color-rule);
}
.member-facts .fact-reason {
  grid-column: 1 / -1;
}
.member-facts .fact-sensitivity {
  grid-column: span 2;
}
.reason-value {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: var(--space-xs);
}
.agent-name {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  margin-left: auto;
}
.presence-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: var(--radius-pill);
}
.presence-dot.online {
  background: var(--color-success);
}
.presence-dot.offline {
  background: var(--color-danger);
}
.pill.abnormal {
  color: var(--color-danger-text);
  border-color: color-mix(in oklch, var(--color-danger) 40%, transparent);
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
  flex: 0 0 auto;
  padding: 1px 7px;
  border-radius: var(--radius-pill);
  font-size: 10.5px;
  color: var(--color-danger-text);
  border: var(--rule-hair) solid color-mix(in oklch, var(--color-danger) 40%, transparent);
  background: var(--danger-soft);
  white-space: nowrap;
}
/* Raw underlying error under the reason chip (verbatim machine text, never
   localized) — ellipsized on one line so a long dial error can't blow the
   column out; the full text is in the hover title. */
.ev-detail {
  display: block;
  min-width: 0;
  color: var(--color-ink-2);
  font-size: var(--text-xs);
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.table-scroll {
  max-width: 100%;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
}
/* "We could not read this" must not look like the calm "nothing to report". */
.warn-text {
  color: var(--color-warning-text);
}
.mini-table {
  width: 100%;
  min-width: 720px;
  border-collapse: collapse;
  font-size: var(--text-sm);
}
.mini-table th,
.mini-table td {
  text-align: left;
  padding: var(--space-2xs) var(--space-xs);
  border-bottom: var(--rule-hair) solid var(--color-rule);
  vertical-align: top;
  /* Keep headers and short values on one line so narrow columns can't collapse
     into single-character vertical wrapping; the target column opts back out. */
  white-space: nowrap;
}
.mini-table th {
  color: var(--color-muted);
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
  min-width: 220px;
  overflow-wrap: anywhere;
}
/* Stack the name and address on separate lines so the URL starts at the cell's
   left edge and every wrapped line stays column-aligned (an inline " · addr"
   would start mid-line and wrap its tail back under the name). */
.ev-target .ev-name,
.ev-target .ev-addr {
  display: block;
}
.notice {
  font-size: var(--text-sm);
  color: var(--color-ink-2);
  background: var(--surface-2);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-input);
  padding: var(--space-2xs) var(--space-xs);
  margin: var(--space-xs) 0;
}
.attribution {
  margin: var(--space-2xs) 0 var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  background: var(--surface-2);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-input);
}
.attribution-sentence {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-md);
  font-weight: 600;
  line-height: 1.35;
  color: var(--color-ink);
}
.attribution-clues {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2xs);
  margin: var(--space-2xs) 0 0;
  padding: 0;
}
/* A clue chip's ✓/✗ mark is the primary signal; colour is an enhancement only. */
.clue {
  font-size: var(--text-xs);
  padding: var(--space-3xs) var(--space-2xs);
  border-radius: var(--radius-input);
  border: var(--rule-hair) solid var(--color-rule);
  color: var(--color-ink-2);
}
.clue.ok {
  color: var(--color-success);
  border-color: color-mix(in srgb, var(--color-success) 35%, var(--color-rule));
}
.clue.fail {
  color: var(--color-danger-text);
  border-color: color-mix(in srgb, var(--color-danger) 35%, var(--color-rule));
}
.timeline {
  list-style: none;
  margin: 0;
  padding: var(--space-2xs) var(--space-3xs);
}
.timeline li {
  display: grid;
  grid-template-columns: minmax(130px, auto) minmax(120px, auto) minmax(0, 1fr) 40ch;
  align-items: baseline;
  gap: var(--space-xs);
  position: relative;
  padding: var(--space-xs) 0 var(--space-xs) var(--space-md);
}
.timeline li:not(:last-child)::before {
  content: '';
  position: absolute;
  left: var(--space-3xs);
  top: var(--space-md);
  bottom: calc(var(--space-3xs) * -1);
  width: var(--rule-hair);
  background: var(--color-rule-2);
}
.timeline .node {
  position: absolute;
  left: 0;
  top: var(--space-xs);
  width: 9px;
  height: 9px;
  border-radius: var(--radius-pill);
  background: var(--color-accent);
}
.timeline .ts {
  color: var(--color-muted);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}
.timeline .kind {
  font-size: var(--text-xs);
  color: var(--color-accent-text);
}
.timeline .msg {
  min-width: 0;
  color: var(--color-ink-2);
  overflow-wrap: anywhere;
}
.timeline .ref {
  width: 40ch;
  max-width: 100%;
  min-width: 0;
  font-family: var(--font-outlier);
  font-size: var(--text-xs);
  color: var(--color-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
@keyframes incident-backdrop-in {
  from { opacity: 0; }
}
@keyframes incident-modal-in {
  from {
    opacity: 0;
    transform: scale(0.985);
  }
}
@keyframes incident-modal-fade {
  from { opacity: 0; }
}
@media (hover: hover) and (pointer: fine) {
  .drawer-close:hover {
    background: var(--color-glass-hover);
    color: var(--color-ink);
  }
}
@media (max-width: 1024px) {
  .drawer {
    inset: 0;
    max-width: none;
    border: 0;
    border-radius: 0;
  }
  .drawer-backdrop {
    display: none;
  }
  .drawer-head {
    padding: var(--space-sm);
  }
  .drawer-body {
    padding: var(--space-sm) var(--space-sm) var(--space-xl);
  }
  .member-facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .timeline li {
    grid-template-columns: minmax(120px, auto) minmax(0, 1fr);
  }
  .timeline .msg,
  .timeline .ref {
    grid-column: 2;
  }
}
@media (max-width: 700px) {
  .drawer-title h3 {
    font-size: var(--text-md);
  }
  .facts,
  .member-facts {
    grid-template-columns: minmax(0, 1fr);
  }
  .member-facts .fact-reason,
  .member-facts .fact-sensitivity {
    grid-column: auto;
  }
  .member-head {
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .member-head > b {
    flex-basis: 100%;
  }
  .agent-name {
    width: 100%;
    margin-left: 0;
  }
  .reason-value {
    flex-direction: column;
  }
  .timeline li {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-3xs);
  }
  .timeline .msg,
  .timeline .ref {
    grid-column: auto;
  }
}
@media (prefers-reduced-motion: reduce) {
  .drawer-backdrop,
  .drawer {
    animation-name: incident-modal-fade;
    animation-duration: var(--dur-micro);
  }
}
</style>
