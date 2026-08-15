<script setup lang="ts">
// Fluctuation history for one target: the failing streaks that recovered before
// reaching the fault threshold.
//
// This is the answer to "availability says 99%, but the fault centre is empty".
// Each row says what failed, when, why no alert fired (2 rounds of 3), and — the
// part that usually settles the diagnosis — whether other targets on the same
// Agent were in trouble at the same moment. Expanding a row shows every round's
// own cause, since a streak can fail differently on each try.
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Fluctuation } from '../api'
import { fmtNum } from '../lib/metricMeta'
import { useMetricMeta } from '../composables/useMetricMeta'
import ProbeRoundsDetail from './ProbeRoundsDetail.vue'

// total is set only when the range holds MORE dips than were fetched, so the header
// can say the list is partial. Silently showing a capped page as if it were the
// whole story would under-report the very count the operator came here for.
//
// loaded distinguishes "there were none" from "we could not find out". Both arrive
// here as an empty list, and announcing a confirmed zero after a failed request is
// the worst possible answer from a table whose entire job is explaining a dip.
// Defaults true so callers that always have data need not pass it.
const props = withDefaults(
  defineProps<{
    items: Fluctuation[]
    showAgent?: boolean
    showTarget?: boolean
    showCount?: boolean
    total?: number
    loaded?: boolean
  }>(),
  { loaded: true, showCount: true },
)
const { t, locale } = useI18n()
const { fmtTime, fmtDur, probeReasonLabel } = useMetricMeta()

const expanded = ref<Set<string>>(new Set())
const toggle = (id: string) => {
  const next = new Set(expanded.value)
  if (!next.delete(id)) next.add(id)
  expanded.value = next
}

const description = (f: Fluctuation) =>
  (locale.value === 'en' ? f.desc_en : f.desc_zh) || f.target_name || f.target_addr

// How long the target was failing, first failing round to recovery.
const outageSec = (f: Fluctuation) =>
  Math.max(0, (new Date(f.ended_at).getTime() - new Date(f.started_at).getTime()) / 1000)

// Other targets on the same Agent that were also failing over this window. The
// distinction it draws is the useful one: a shared cause versus this target alone.
// The server already counts this as a distinct union over dips and faults — adding
// the two breakdowns here would double-count a neighbour that did both.
const concurrent = (f: Fluctuation) => f.concurrent_targets

const hasRounds = (f: Fluctuation) => (f.rounds?.length ?? 0) > 0
const detailColspan = () => 5 + Number(props.showAgent) + Number(props.showTarget)
</script>

<template>
  <div class="card flux-card">
    <div class="flux-head">
      <div>
        <h3>{{ t('targetStatus.fluctuations') }}</h3>
        <p class="hint">{{ t('targetStatus.fluctuationsHint') }}</p>
      </div>
      <span v-if="showCount && props.items.length" class="count">
        {{
          props.total
            ? t('targetStatus.fluctuationsPartial', { n: props.items.length, total: props.total })
            : t('metrics.recentN', { n: props.items.length })
        }}
      </span>
    </div>
    <p v-if="!props.loaded" class="hint pad">{{ t('targetStatus.fluctuationsUnavailable') }}</p>
    <p v-else-if="!props.items.length" class="hint pad">{{ t('targetStatus.noFluctuations') }}</p>
    <table v-else class="flux">
      <thead>
        <tr>
          <th class="expander"></th>
          <th>{{ t('metrics.thTime') }}</th>
          <th v-if="showAgent">{{ t('metrics.thAgent') }}</th>
          <th v-if="showTarget">{{ t('targetStatus.targetColumn') }}</th>
          <th>{{ t('metrics.thFault') }}</th>
          <th>{{ t('targetStatus.thFailRounds') }}</th>
          <th>{{ t('targetStatus.thScope') }}</th>
          <th class="num">{{ t('metrics.thTriggerVal') }}</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="f in props.items" :key="f.id">
          <tr :class="{ 'is-open': expanded.has(f.id) }">
            <td class="expander">
              <button
                v-if="hasRounds(f)"
                type="button"
                class="toggle"
                :aria-expanded="expanded.has(f.id)"
                :title="t('targetStatus.roundBreakdown')"
                @click="toggle(f.id)"
              >{{ expanded.has(f.id) ? '−' : '+' }}</button>
            </td>
            <td class="mono">
              {{ fmtTime(f.started_at) }}
              <span class="sub">{{ t('targetStatus.fluctuationLasted', { d: fmtDur(outageSec(f)) }) }}</span>
            </td>
            <td v-if="showAgent" class="mono">{{ f.agent_name || f.agent_id }}</td>
            <td v-if="showTarget" class="target-cell">
              <strong>{{ f.target_name || f.target_addr || f.target_id }}</strong>
              <span v-if="f.target_addr && f.target_addr !== f.target_name" class="sub mono">{{ f.target_addr }}</span>
            </td>
            <td>{{ description(f) }}</td>
            <td>
              <span class="rounds-chip">
                {{ t('targetStatus.failRoundsOfNeed', { n: f.fail_rounds, need: f.fail_threshold }) }}
              </span>
            </td>
            <td>
              <!-- A precursor outranks the concurrency hint: once a real fault
                   claimed this streak, that is the more useful thing to say. -->
              <router-link
                v-if="f.incident_id"
                class="tag is-linked"
                :to="`/incidents?incident=${encodeURIComponent(f.incident_id)}`"
                :title="t('targetStatus.fluctuationLinkedHint')"
              >{{ t('targetStatus.fluctuationLinked') }}</router-link>
              <span
                v-else-if="concurrent(f) > 0"
                class="tag is-shared"
                :title="t('targetStatus.fluctuationConcurrentHint', {
                  f: f.concurrent_fluctuations,
                  a: f.concurrent_faults,
                })"
              >{{ t('targetStatus.fluctuationConcurrent', { n: concurrent(f) }) }}</span>
              <span v-else class="tag is-isolated">{{ t('targetStatus.fluctuationIsolated') }}</span>
            </td>
            <td class="num mono">
              {{ f.metric_kind ? fmtNum(f.value) : '—' }}
              <span
                v-if="f.reason_code > 0"
                class="reason-chip"
                :title="f.reason_detail || undefined"
              >{{ probeReasonLabel(f.reason_code) }}</span>
            </td>
          </tr>
          <tr v-if="expanded.has(f.id) && f.rounds" class="detail-row">
            <td></td>
            <td :colspan="detailColspan()">
              <ProbeRoundsDetail :rounds="f.rounds" />
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.flux-card {
  margin-top: 20px;
  padding: 16px 18px;
}
.flux-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}
.flux-head h3 {
  margin: 0;
  font-size: 15px;
}
.flux-head .hint {
  margin: 4px 0 0;
  font-size: 12px;
}
.flux-head .count {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
}
.flux {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.flux th,
.flux td {
  text-align: left;
  padding: 9px 10px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
.flux th {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  font-weight: 600;
}
.flux tbody tr:last-child td {
  border-bottom: none;
}
.flux tr.is-open td {
  border-bottom-color: transparent;
}
.flux .detail-row td {
  padding-top: 0;
}
.flux .num {
  text-align: right;
}
.flux .mono {
  font-variant-numeric: tabular-nums;
  color: var(--text-dim);
}
.flux .sub {
  display: block;
  font-size: 11px;
  color: var(--text-muted);
}
.target-cell strong {
  display: block;
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
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
.rounds-chip,
.tag {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  white-space: nowrap;
  border: 1px solid transparent;
}
.rounds-chip {
  color: var(--text-dim);
  border-color: var(--border-strong);
}
/* Warm: something bigger than this target was going on. */
.tag.is-shared {
  color: var(--color-warning-text);
  border-color: rgba(251, 191, 36, 0.4);
  background: rgba(251, 191, 36, 0.1);
}
/* Muted: nothing else was affected — deliberately unalarming. */
.tag.is-isolated {
  color: var(--text-muted);
  border-color: var(--border);
}
.tag.is-linked {
  color: var(--color-danger-text);
  border-color: rgba(248, 113, 113, 0.4);
  background: rgba(248, 113, 113, 0.1);
  text-decoration: none;
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
