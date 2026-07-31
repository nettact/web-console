<script setup lang="ts">
// Fault history for one target or Agent. `showAgent` adds an Agent column for the
// cross-agent view where rows come from several agents. Shared by the Host
// Metrics, Agent detail and Target Status pages.
//
// A row states what broke and why — the server renders the standard statement and
// freezes the failure reason at confirmation time, so the table never has to
// re-derive a description from raw metrics.
//
// A row expands to the cause of every round of the confirming streak, the same
// breakdown a fluctuation offers: the summary carries only the confirming round,
// and "timed out twice then refused" is a different diagnosis from three refusals.
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FaultSignal } from '../api'
import { fmtNum } from '../lib/metricMeta'
import { useMetricMeta } from '../composables/useMetricMeta'
import ProbeRoundsDetail from './ProbeRoundsDetail.vue'

defineProps<{ signals: FaultSignal[]; showAgent?: boolean }>()
const { t, locale } = useI18n()
const { sevTone, sevLabel, fmtTime, probeReasonLabel } = useMetricMeta()

const expanded = ref<Set<string>>(new Set())
const toggle = (id: string) => {
  const next = new Set(expanded.value)
  if (!next.delete(id)) next.add(id)
  expanded.value = next
}
// Agent-connectivity faults have no probe rounds, so there is nothing to expand.
const hasRounds = (s: FaultSignal) => (s.rounds?.length ?? 0) > 0

const description = (s: FaultSignal) =>
  s.title || (locale.value === 'en' ? s.desc_en : s.desc_zh) || s.target_name || s.target_addr

// A fault ended by a configuration change is shown as its own state, never as a
// recovery: the fault did not go away, it stopped being observable.
const stateKey = (s: FaultSignal) => {
  if (s.state === 'firing') return 'firing'
  return s.resolve_reason && s.resolve_reason !== 'recovered' ? 'terminated' : 'resolved'
}
</script>

<template>
  <div class="card alerts-card">
    <div class="alerts-head">
      <h3>{{ t('metrics.faultRecords') }}</h3>
      <span class="count" v-if="signals.length">{{ t('metrics.recentN', { n: signals.length }) }}</span>
    </div>
    <p v-if="!signals.length" class="hint pad">{{ t('metrics.noFaultRecords') }}</p>
    <table v-else class="alerts">
      <thead>
        <tr>
          <th class="expander"></th>
          <th>{{ t('metrics.thTime') }}</th>
          <th v-if="showAgent">{{ t('metrics.thAgent') }}</th>
          <th>{{ t('metrics.thFault') }}</th>
          <th>{{ t('metrics.thLevel') }}</th>
          <th>{{ t('metrics.thState') }}</th>
          <th class="num">{{ t('metrics.thTriggerVal') }}</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="s in signals" :key="s.id">
          <tr :class="{ 'is-open': expanded.has(s.id) }">
            <td class="expander">
              <button
                v-if="hasRounds(s)"
                type="button"
                class="toggle"
                :aria-expanded="expanded.has(s.id)"
                :title="t('targetStatus.roundBreakdown')"
                @click="toggle(s.id)"
              >{{ expanded.has(s.id) ? '−' : '+' }}</button>
            </td>
            <td class="mono">{{ fmtTime(s.confirmed_at) }}</td>
            <td v-if="showAgent" class="mono">{{ s.agent_name || s.agent_id }}</td>
            <td>
              <router-link
                v-if="s.incident_id"
                class="link"
                :to="`/incidents?incident=${encodeURIComponent(s.incident_id)}`"
              >{{ description(s) }}</router-link>
              <template v-else>{{ description(s) }}</template>
            </td>
            <td><span class="sev" :class="`is-${sevTone(s.severity)}`">{{ sevLabel(s.severity) }}</span></td>
            <td>{{ t(`metrics.faultState.${stateKey(s)}`) }}</td>
            <td class="num mono">
              {{ s.metric_kind ? fmtNum(s.value) : '—' }}
              <span
                v-if="s.reason_code > 0"
                class="reason-chip"
                :title="s.reason_detail || undefined"
              >{{ probeReasonLabel(s.reason_code) }}</span>
            </td>
          </tr>
          <tr v-if="expanded.has(s.id) && s.rounds" class="detail-row">
            <td></td>
            <td :colspan="showAgent ? 6 : 5">
              <ProbeRoundsDetail :rounds="s.rounds" />
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.alerts-card {
  margin-top: 20px;
  padding: 16px 18px;
}
.alerts-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12px;
}
.alerts-head h3 {
  margin: 0;
  font-size: 15px;
}
.alerts-head .count {
  font-size: 12px;
  color: var(--text-muted);
}
.alerts {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.alerts th,
.alerts td {
  text-align: left;
  padding: 9px 10px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
.alerts tr.is-open td {
  border-bottom-color: transparent;
}
.alerts .detail-row td {
  padding-top: 0;
}
.expander {
  width: 28px;
  padding-right: 0 !important;
}
.toggle {
  width: 20px;
  height: 20px;
  line-height: 1;
  border-radius: 5px;
  border: 1px solid var(--border-strong);
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 13px;
}
.toggle:hover {
  color: var(--text);
  border-color: var(--text-muted);
}
.alerts th {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  font-weight: 600;
}
.alerts tbody tr:last-child td {
  border-bottom: none;
}
.alerts .num {
  text-align: right;
}
.alerts .mono {
  font-variant-numeric: tabular-nums;
  color: var(--text-dim);
}
.sev {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  border: 1px solid transparent;
}
.sev.is-bad {
  color: var(--color-danger-text);
  border-color: rgba(248, 113, 113, 0.4);
  background: rgba(248, 113, 113, 0.1);
}
.sev.is-unknown {
  color: var(--text-dim);
  border-color: var(--border-strong);
}
.reason-chip {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  color: var(--color-danger-text);
  border: 1px solid rgba(248, 113, 113, 0.4);
  background: rgba(248, 113, 113, 0.1);
  white-space: nowrap;
}
.pad {
  padding: 8px 2px;
}
</style>
