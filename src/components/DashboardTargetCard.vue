<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { Sample, TargetStatusRow } from '../api'
import { useMetricMeta } from '../composables/useMetricMeta'
import { HTTP_TIMING_KINDS, natCodeLabel } from '../lib/metricMeta'
import { formatAvailability } from '../lib/targetStatus'
import { targetStatus } from '../targetStatus'

const props = defineProps<{
  target: TargetStatusRow
  agentId: string
  samples: Sample[]
}>()

const { t, te } = useI18n()
const { metricLabel } = useMetricMeta()
const agent = computed(() => props.target.agents.find((row) => row.agent_id === props.agentId) ?? null)
const sampleMap = computed(() => new Map(props.samples.map((sample) => [sample.kind, sample])))
const sample = (kind: string) => sampleMap.value.get(kind)

const tone = computed(() => {
  const row = agent.value
  if (!row) return 'unknown'
  if (row.execution_state === 'agent_offline') return 'bad'
  if (row.execution_state === 'permission_blocked' || row.execution_state === 'target_blocked') return 'warn'
  if (row.execution_state !== 'collecting') return 'unknown'
  if (row.probe_state === 'healthy') return 'good'
  if (row.probe_state === 'failed') return 'bad'
  if (row.probe_state === 'stale') return 'warn'
  return 'unknown'
})

const statusLabel = computed(() => {
  const row = agent.value
  if (!row) return t('targetStatus.probe.not_applicable')
  const key = `targetStatus.reason.${row.reason_code}`
  return te(key) ? t(key) : row.reason_code
})

function valueWithUnit(value: number | undefined, unit: string, digits = 0): string {
  return value == null ? '—' : unit ? `${value.toFixed(digits)} ${unit}` : value.toFixed(digits)
}

const primary = computed(() => {
  switch (props.target.kind) {
    case 'icmp':
    case 'gateway':
      return valueWithUnit(sample('probe.icmp.rtt_ms')?.value, 'ms')
    case 'dns':
      return valueWithUnit(sample('probe.dns.resolve_ms')?.value, 'ms')
    case 'http': {
      const status = sample('probe.http.status')?.value
      return status == null ? '—' : `HTTP ${Math.round(status)}`
    }
    case 'tcp':
      return valueWithUnit(sample('probe.tcp.connect_ms')?.value, 'ms')
    case 'nat': {
      const type = sample('probe.nat.type')
      return type ? natCodeLabel(type.kind, type.value) : '—'
    }
    default:
      return agent.value?.last_value == null ? '—' : valueWithUnit(agent.value.last_value, agent.value.last_unit ?? '')
  }
})

const details = computed(() => {
  const items: Array<{ label: string; value: string }> = []
  const add = (label: string, kind: string, unit: string, digits = 0) => {
    const value = sample(kind)?.value
    if (value != null) items.push({ label, value: valueWithUnit(value, unit, digits) })
  }
  switch (props.target.kind) {
    case 'icmp':
    case 'gateway':
      add(t('dashboard.targetLoss'), 'probe.icmp.loss_pct', '%')
      add(t('dashboard.targetJitter'), 'probe.icmp.jitter_ms', 'ms')
      break
    case 'dns':
      items.push({ label: t('dashboard.targetResult'), value: statusLabel.value })
      break
    case 'http':
      // New agents report request phases separately. Show the three broadest
      // available timings without expanding the compact card; older agents keep
      // the established latency detail rather than losing their only timing.
      {
        const hasTimingPhases = HTTP_TIMING_KINDS.some((kind) => sample(kind)?.value != null)
        if (hasTimingPhases) {
          for (const kind of HTTP_TIMING_KINDS) add(metricLabel(kind), kind, 'ms')
        } else {
          add(t('dashboard.targetLatency'), 'probe.http.latency_ms', 'ms')
        }
      }
      break
    case 'tcp':
      add(t('dashboard.targetDnsPhase'), 'probe.tcp.dns_ms', 'ms')
      add(t('dashboard.targetTlsPhase'), 'probe.tcp.tls_ms', 'ms')
      break
    case 'nat': {
      const mapping = sample('probe.nat.mapping')
      if (mapping) items.push({ label: t('dashboard.natMapping'), value: natCodeLabel(mapping.kind, mapping.value) })
      add(t('dashboard.targetLatency'), 'probe.nat.rtt_ms', 'ms')
      break
    }
  }
  if (agent.value?.availability != null) {
    items.push({ label: t(`targetStatus.availability${targetStatus.timeRange}`), value: formatAvailability(agent.value.availability) ?? '—' })
  }
  return items.slice(0, 3)
})

const typeLabel = computed(() => {
  const key = `dashboard.monitorType_${props.target.kind}`
  return te(key) ? t(key) : props.target.kind.toUpperCase()
})
</script>

<template>
  <div class="target-card-body" :class="`tone-${tone}`">
    <div class="target-card-head">
      <span class="target-kind" :class="`kind-${target.kind}`">{{ typeLabel }}</span>
      <span class="target-state" :class="tone"><i></i>{{ statusLabel }}</span>
    </div>
    <RouterLink class="target-title" :to="{ path: '/target-status', query: { agent: agentId, target: target.target_id } }">
      {{ target.name }}
    </RouterLink>
    <p class="target-address mono">{{ target.target }}</p>
    <strong class="target-primary">{{ primary }}</strong>
    <div v-if="details.length" class="target-details">
      <span v-for="item in details" :key="item.label"><small>{{ item.label }}</small><b>{{ item.value }}</b></span>
    </div>
    <p v-else class="target-empty">{{ t('common.noData') }}</p>
  </div>
</template>

<style scoped>
/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * component: monitor target · design-system: design.md
 */
.target-card-body {
  --target-tone: var(--color-neutral);
  position: relative;
  min-height: 190px;
  padding: 20px;
  overflow: hidden;
  background: color-mix(in srgb, var(--target-tone) 4%, transparent);
}
.target-card-body.tone-good { --target-tone: var(--color-success); }
.target-card-body.tone-warn { --target-tone: var(--color-warning); }
.target-card-body.tone-bad { --target-tone: var(--color-danger); }
.target-card-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.target-kind { padding: 4px 8px; color: var(--color-accent-text); font-size: 10px; font-weight: 800; letter-spacing: .08em; border: 1px solid color-mix(in srgb, var(--color-accent) 48%, transparent); border-radius: 6px; background: color-mix(in srgb, var(--color-accent) 14%, transparent); }
.target-kind.kind-http { color: var(--color-warning-text); border-color: color-mix(in srgb, var(--color-warning) 48%, transparent); background: color-mix(in srgb, var(--color-warning) 14%, transparent); }
.target-kind.kind-tcp { color: var(--color-info-text); }
.target-kind.kind-nat { color: var(--color-accent-text); border-color: color-mix(in srgb, var(--color-accent) 48%, transparent); background: color-mix(in srgb, var(--color-accent) 12%, transparent); }
.target-state { --target-state-color: var(--color-muted); display: inline-flex; align-items: center; gap: 6px; color: var(--color-muted); font-size: 11px; }
.target-state i { width: 7px; height: 7px; border-radius: 50%; background: var(--target-state-color); }
.target-state.good { --target-state-color: var(--color-success); color: var(--color-success-text); }.target-state.warn { --target-state-color: var(--color-warning); color: var(--color-warning-text); }.target-state.bad { --target-state-color: var(--color-danger); color: var(--color-danger-text); }
.target-title { display: block; width: fit-content; max-width: 100%; margin-top: 15px; overflow: hidden; color: var(--color-ink); font-size: 16px; font-weight: 750; text-decoration: none; text-overflow: ellipsis; white-space: nowrap; }
.target-title:hover,
.target-title:focus-visible { color: var(--color-accent-text); }
.target-title:focus-visible { border-radius: var(--radius-xs); outline: 2px solid var(--color-focus); outline-offset: 3px; }
.target-address { margin: 4px 0 0; overflow: hidden; color: var(--color-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.target-primary { display: block; margin-top: 20px; color: var(--color-ink); font-size: 32px; line-height: 1; letter-spacing: -.04em; }
.target-primary,
.target-details b { font-variant-numeric: tabular-nums; }
.tone-bad .target-primary { color: var(--color-danger-text); }
.target-details { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 18px; padding-top: 13px; border-top: 1px solid var(--color-rule); }
.target-details span { display: grid; gap: 3px; }
.target-details small { color: var(--color-muted); font-size: 9px; }
.target-details b { font-size: 11px; font-weight: 700; }
.target-empty { margin: 18px 0 0; color: var(--color-muted); font-size: 11px; }
</style>
