<script setup lang="ts">
// One shared traceroute report (DIAG-001). Every incident/alert/condition that
// references this report reads the identical execution via its report id, so this
// card is a faithful render of one execution: status, stable reason, detecting
// Agent, destination, mode/port, timing, reached verdict and the full per-attempt
// hop table. It deliberately never claims a traceroute proves a root cause or
// carrier responsibility, and an intermediate `*` (timeout) is not a breakpoint.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TraceReportView } from '../../api'
import { useIncidentLabels, statusTone } from '../../composables/useIncidentLabels'
import { toDateLocale } from '../../i18n'

const props = defineProps<{ report: TraceReportView }>()

const { t, locale } = useI18n()
const {
  traceStatusLabel, traceReasonLabel, traceReasonDetail, fallbackReasonDetail, modeLabel,
  traceSubjectLabel, traceSubjectDetail,
} = useIncidentLabels()

// Long-form "why it couldn't trace" text, shown when the run ended on a terminal
// failure reason (report.reason is only set for non-success terminal states).
const reasonDetail = computed(() => (props.report.reason ? traceReasonDetail(props.report.reason) : ''))

// TCP -> ICMP auto-fallback (the only kind currently supported): the Agent
// couldn't run the requested TCP traceroute (no admin rights or no grant) and
// transparently re-ran it as ICMP. report.mode already reflects the mode that
// actually executed.
const isTcpFallback = computed(() => props.report.fallback_from === 'tcp')
// "TCP:80" / "TCP" — the mode+port the run was originally requested as.
const fallbackFromLabel = computed(() => {
  const r = props.report
  const from = modeLabel(r.fallback_from || '')
  return r.port ? `${from}:${r.port}` : from
})
const fallbackDetail = computed(() =>
  props.report.fallback_reason ? fallbackReasonDetail(props.report.fallback_reason) : '',
)

// Diagnosis subject (DIAG-003): what was traced, when it is not the monitored
// target. A DNS fault traces its resolver, a proxied fault its proxy, a
// WireGuard fault the peer's physical path — the destination row alone reads as
// "the monitored thing" in every case, so the badge and note say otherwise.
const isSubjectTarget = computed(() => {
  const k = props.report.subject_kind
  return !k || k === 'target'
})
const subjectDetail = computed(() =>
  traceSubjectDetail(props.report.subject_kind || '', props.report.subject_reason || ''),
)

const fmtDateTime = (s: string | null) =>
  s ? new Date(s).toLocaleString(toDateLocale(locale.value), { hour12: false }) : '—'

const running = computed(() => props.report.status === 'queued' || props.report.status === 'running')

// Elapsed time: start → finish (or start → deadline while still running).
const duration = computed(() => {
  const r = props.report
  if (!r.started_at) return '—'
  const start = new Date(r.started_at).getTime()
  const end = r.completed_at ? new Date(r.completed_at).getTime() : NaN
  if (Number.isNaN(end)) return '—'
  const ms = end - start
  if (ms < 0) return '—'
  return `${(ms / 1000).toFixed(1)} s`
})

// Widest attempt count across hops → one table column per attempt index.
const attemptCount = computed(() =>
  props.report.hops.reduce((m, h) => Math.max(m, h.attempts.length), 0),
)
const attemptCols = computed(() => Array.from({ length: attemptCount.value }, (_, i) => i))

// Destination display: host, plus the resolved IP when known and different. A
// report that terminalized before it had a destination (an unnameable resolver
// or proxy) has none to show; the reason note below says why.
const dest = computed(() => {
  const r = props.report
  if (r.dest_ip && r.dest_ip !== r.dest_host) return `${r.dest_host} (${r.dest_ip})`
  return r.dest_ip || r.dest_host || '—'
})

// Attempt at a hop for an attempt-index column, or null when this hop has fewer.
function attemptAt(hop: TraceReportView['hops'][number], idx: number) {
  return hop.attempts[idx] ?? null
}
</script>

<template>
  <div class="card trace">
    <div class="trace-head">
      <div class="th-left">
        <span class="badge" :class="statusTone(report.status)">{{ traceStatusLabel(report.status) }}</span>
        <span class="mode badge neutral">{{ modeLabel(report.mode) }}<template v-if="report.port && !isTcpFallback">:{{ report.port }}</template></span>
        <span v-if="isTcpFallback" class="badge warn" :title="fallbackDetail || undefined">
          {{ fallbackFromLabel }} → {{ modeLabel(report.mode) }}
        </span>
        <span v-if="!isSubjectTarget" class="badge neutral" :title="subjectDetail || undefined">
          {{ traceSubjectLabel(report.subject_kind) }}
        </span>
        <span v-if="report.reason" class="hint reason">{{ traceReasonLabel(report.reason) }}</span>
      </div>
      <code class="rid" :title="report.report_id">{{ report.report_id }}</code>
    </div>

    <p v-if="fallbackDetail" class="fallback-detail" role="note">{{ fallbackDetail }}</p>
    <p v-if="subjectDetail" class="reason-detail" role="note">{{ subjectDetail }}</p>
    <p v-if="reasonDetail" class="reason-detail" role="note">{{ reasonDetail }}</p>

    <dl class="facts">
      <div><dt>{{ t('incidents.trace.agent') }}</dt><dd>{{ report.agent_name || report.agent_id }}</dd></div>
      <div>
        <!-- Labelled by subject so the destination cannot be misread as the
             monitored target when the diagnostic examined something else. -->
        <dt>{{ isSubjectTarget ? t('incidents.trace.dest') : traceSubjectLabel(report.subject_kind) }}</dt>
        <dd class="mono">{{ dest }}</dd>
      </div>
      <div>
        <dt>{{ t('incidents.trace.reached') }}</dt>
        <dd>
          <span class="badge" :class="report.reached ? 'ok' : 'neutral'">
            {{ report.reached ? t('incidents.trace.reachedYes') : t('incidents.trace.reachedNo') }}
          </span>
          <span v-if="report.reached && report.reached_ttl" class="hint"> · TTL {{ report.reached_ttl }}</span>
        </dd>
      </div>
      <div><dt>{{ t('incidents.trace.requestedAt') }}</dt><dd>{{ fmtDateTime(report.requested_at) }}</dd></div>
      <div><dt>{{ t('incidents.trace.startedAt') }}</dt><dd>{{ fmtDateTime(report.started_at) }}</dd></div>
      <div><dt>{{ t('incidents.trace.finishedAt') }}</dt><dd>{{ fmtDateTime(report.completed_at) }}</dd></div>
      <div><dt>{{ t('incidents.trace.duration') }}</dt><dd>{{ duration }}</dd></div>
    </dl>

    <p v-if="running" class="hint running-note">{{ t('incidents.trace.inProgress') }}</p>

    <!-- Semantic hop table: one row per TTL, one column per probe attempt. -->
    <div v-if="report.hops.length" class="table-wrap">
      <table class="hops" :aria-label="t('incidents.trace.hopTableAria')">
        <thead>
          <tr>
            <th scope="col">{{ t('incidents.trace.ttl') }}</th>
            <th v-for="i in attemptCols" :key="i" scope="col">
              {{ t('incidents.trace.attemptN', { n: i + 1 }) }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="hop in report.hops" :key="hop.ttl">
            <th scope="row" class="ttl">{{ hop.ttl }}</th>
            <td v-for="i in attemptCols" :key="i" class="attempt">
              <template v-if="attemptAt(hop, i)">
                <template v-if="attemptAt(hop, i)!.timeout">
                  <span class="star" :title="t('incidents.trace.timeout')" :aria-label="t('incidents.trace.timeout')">*</span>
                </template>
                <template v-else>
                  <span class="rtt">{{ attemptAt(hop, i)!.rtt_ms?.toFixed(1) ?? '—' }} ms</span>
                  <span class="addr mono">{{ attemptAt(hop, i)!.addr || '—' }}</span>
                  <span v-if="attemptAt(hop, i)!.hostname" class="host mono hint">
                    {{ attemptAt(hop, i)!.hostname }}
                  </span>
                </template>
              </template>
              <span v-else class="empty" aria-hidden="true">·</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else-if="!running" class="hint">{{ t('incidents.trace.noHops') }}</p>

    <!-- Interpretation disclaimers (always shown). -->
    <p class="disclaimer">{{ t('incidents.trace.starNote') }}</p>
    <p class="disclaimer">{{ t('incidents.trace.rootCauseNote') }}</p>
  </div>
</template>

<style scoped>
.card.trace {
  padding: 14px 16px;
  margin: 10px 0;
}
.trace-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.th-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.rid {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-muted);
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 22px;
  margin: 12px 0 6px;
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
  /* Reset the browser's default 40px dd indent so each value sits next to its
     label instead of far to the right. */
  margin: 0;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.running-note {
  margin: 4px 0;
}
/* Prominent-but-calm explanation of why a trace couldn't complete. */
.reason-detail {
  margin: 10px 0 2px;
  padding: 8px 11px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-dim);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
/* Same treatment as .reason-detail, but in the warn palette (matches .badge.warn)
   since a mode fallback isn't a failure — the trace still completed. */
.fallback-detail {
  margin: 10px 0 2px;
  padding: 8px 11px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--color-warning-text);
  background: var(--warning-soft);
  border: 1px solid rgba(251, 191, 36, 0.3);
  border-radius: var(--radius-sm);
}
.table-wrap {
  overflow-x: auto;
  margin: 10px 0;
}
table.hops {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
table.hops th,
table.hops td {
  text-align: left;
  padding: 5px 9px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
table.hops thead th {
  color: var(--text-muted);
  font-weight: 600;
}
.ttl {
  font-variant-numeric: tabular-nums;
  color: var(--text-dim);
  width: 44px;
}
.attempt {
  display: table-cell;
}
.attempt .rtt {
  display: block;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}
.attempt .addr {
  display: block;
  color: var(--text-dim);
}
.attempt .host {
  display: block;
}
.star {
  color: var(--text-muted);
  font-weight: 700;
}
.empty {
  color: var(--text-muted);
}
.disclaimer {
  font-size: 11.5px;
  color: var(--text-muted);
  margin: 6px 0 0;
  line-height: 1.5;
}
</style>
