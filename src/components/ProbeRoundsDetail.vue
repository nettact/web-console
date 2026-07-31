<script setup lang="ts">
// The per-round breakdown of a failing streak, shared by the fault table and the
// fluctuation table.
//
// It exists because a single frozen reason hides the thing that actually explains
// a failure. "Refused" on its own points at the service; "timed out, timed out,
// then refused" points at a link that dropped and a service that came back
// answering. The summary row can only carry the last round, so the rounds go here
// — including the raw underlying error, verbatim and unlocalized, because that is
// the string an operator pastes into a search or hands to an ISP.
import { useI18n } from 'vue-i18n'
import type { ProbeRound } from '../api'
import { fmtNum } from '../lib/metricMeta'
import { toDateLocale } from '../i18n'
import { useMetricMeta } from '../composables/useMetricMeta'

defineProps<{ rounds: ProbeRound[] }>()
const { t, locale } = useI18n()
const { probeReasonLabel, metricLabel } = useMetricMeta()

// Only the clock: every round of one streak falls on the same day, and the row
// above already carries the date.
const fmtRoundTime = (ts: number) =>
  new Date(ts * 1000).toLocaleTimeString(toDateLocale(locale.value), { hour12: false })

// Every round listed here FAILED, so a probe's 0/1 success flag must never be
// rendered as "<label> <value>". Four of the five primary metrics are such flags
// and their labels are affirmative — "请求成功", "解析成功", "连接成功" — so a
// failing round came out as "请求成功 0", which reads as the exact opposite of
// what happened. The flag also carries no information the row does not already
// state, so it is dropped rather than reworded.
//
// probe.icmp.loss_pct is the one primary metric whose value is a magnitude: 100%
// loss and 60% loss are different findings, so it stays.
const isSuccessFlag = (kind: string) => kind.endsWith('.ok')

// Percentage kinds print their unit; nothing else numeric reaches this list today.
const fmtValue = (r: ProbeRound) =>
  `${fmtNum(r.value)}${r.metric_kind.endsWith('_pct') ? '%' : ''}`

const showsValue = (r: ProbeRound) => !!r.metric_kind && !isSuccessFlag(r.metric_kind)

// With the flag suppressed, a round carrying neither a reason code nor a magnitude
// would render as a bare timestamp. Say plainly that it failed instead.
const needsFallback = (r: ProbeRound) => r.reason_code <= 0 && !showsValue(r)
</script>

<template>
  <div class="rounds">
    <div class="rounds-title">{{ t('targetStatus.roundBreakdown') }}</div>
    <ol class="round-list">
      <li v-for="(r, i) in rounds" :key="`${r.ts}-${i}`">
        <span class="idx">{{ t('targetStatus.roundNo', { i: i + 1 }) }}</span>
        <span class="ts mono">{{ fmtRoundTime(r.ts) }}</span>
        <span v-if="r.reason_code > 0" class="reason-chip">{{ probeReasonLabel(r.reason_code) }}</span>
        <span v-else-if="needsFallback(r)" class="reason-chip">{{ t('targetStatus.roundFailed') }}</span>
        <span v-if="showsValue(r)" class="val mono">
          {{ metricLabel(r.metric_kind) }} {{ fmtValue(r) }}
        </span>
        <!-- Verbatim: the machine text is the actionable part. -->
        <code v-if="r.reason_detail" class="detail" :title="r.reason_detail">{{ r.reason_detail }}</code>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.rounds {
  padding: 4px 2px 10px;
}
.rounds-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  font-weight: 600;
  margin-bottom: 6px;
}
.round-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.round-list li {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 12px;
}
.idx {
  color: var(--text-muted);
  min-width: 3.5em;
}
.ts,
.val {
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.detail {
  font-size: 11px;
  color: var(--text-muted);
  background: var(--bg-inset, rgba(148, 163, 184, 0.1));
  border-radius: 4px;
  padding: 1px 6px;
  max-width: 46ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.reason-chip {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  color: var(--color-danger-text);
  border: 1px solid rgba(248, 113, 113, 0.4);
  background: rgba(248, 113, 113, 0.1);
  white-space: nowrap;
}
</style>
