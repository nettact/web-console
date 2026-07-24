<script setup lang="ts">
// Alarm-history table for a target. `showAgent` adds an Agent column for the
// cross-agent (by-target) view where rows come from several agents. Shared by the
// Host Metrics and Target Status pages.
import { useI18n } from 'vue-i18n'
import type { Alert } from '../api'
import { fmtNum } from '../lib/metricMeta'
import { useMetricMeta } from '../composables/useMetricMeta'

defineProps<{ alerts: Alert[]; showAgent?: boolean }>()
const { t } = useI18n()
const { sevTone, sevLabel, fmtTime, probeReasonLabel } = useMetricMeta()

// An alert instance (keyed rule+Agent) freezes the value of every contributing
// condition. Render each evidence value; an AND rule that fired on several
// conditions shows them all.
const triggerValues = (a: Alert) =>
  a.evidence.length ? a.evidence.map((ev) => fmtNum(ev.value)).join(', ') : '—'

// Distinct frozen failure reasons across an alert's evidence (unreachable / DNS-
// failed / …), shown as chips so the row states WHY, not just the breached value.
// Deduped by label; each chip carries the first non-empty raw reason_detail of
// its label's evidence as the hover title (the verbatim low-level error).
const reasonLabels = (a: Alert): { label: string; title: string | undefined }[] => {
  const byLabel = new Map<string, string | undefined>()
  for (const ev of a.evidence) {
    if (ev.reason_code <= 0) continue
    const label = probeReasonLabel(ev.reason_code)
    if (!byLabel.get(label)) byLabel.set(label, ev.reason_detail || undefined)
  }
  return [...byLabel].map(([label, title]) => ({ label, title }))
}
</script>

<template>
  <div class="card alerts-card">
    <div class="alerts-head">
      <h3>{{ t('metrics.alertRecords') }}</h3>
      <span class="count" v-if="alerts.length">{{ t('metrics.recentN', { n: alerts.length }) }}</span>
    </div>
    <p v-if="!alerts.length" class="hint pad">{{ t('metrics.noAlertRecords') }}</p>
    <table v-else class="alerts">
      <thead>
        <tr>
          <th>{{ t('metrics.thTime') }}</th>
          <th v-if="showAgent">{{ t('metrics.thAgent') }}</th>
          <th>{{ t('metrics.thRule') }}</th>
          <th>{{ t('metrics.thLevel') }}</th>
          <th>{{ t('metrics.thState') }}</th>
          <th class="num">{{ t('metrics.thTriggerVal') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="a in alerts" :key="a.id">
          <td class="mono">{{ fmtTime(a.started_at) }}</td>
          <td v-if="showAgent" class="mono">{{ a.agent_host || a.agent_id }}</td>
          <td>{{ a.rule_name }}</td>
          <td><span class="sev" :class="`is-${sevTone(a.severity)}`">{{ sevLabel(a.severity) }}</span></td>
          <td>{{ a.state === 'resolved' ? t('metrics.stateResolved') : a.state === 'firing' ? t('metrics.stateFiring') : a.state }}</td>
          <td class="num mono">
            {{ triggerValues(a) }}
            <span v-for="r in reasonLabels(a)" :key="r.label" class="reason-chip" :title="r.title">{{ r.label }}</span>
          </td>
        </tr>
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
  color: #fca5a5;
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
  color: #fca5a5;
  border: 1px solid rgba(248, 113, 113, 0.4);
  background: rgba(248, 113, 113, 0.1);
  white-space: nowrap;
}
.pad {
  padding: 8px 2px;
}
</style>
