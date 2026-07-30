<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { Sample, TargetStatusRow } from '../api'
import { natCodeLabel } from '../lib/metricMeta'

const props = defineProps<{
  target: TargetStatusRow
  agentId: string
  samples: Sample[]
}>()

const { t, te } = useI18n()
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
      add(t('dashboard.targetLatency'), 'probe.http.latency_ms', 'ms')
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
  if (agent.value?.availability_24h != null) {
    items.push({ label: t('targetStatus.availability24h'), value: `${(agent.value.availability_24h * 100).toFixed(1)}%` })
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
.target-card-body { position: relative; min-height: 190px; padding: 20px; overflow: hidden; }
.target-card-body::before { content: ''; position: absolute; inset: 0 0 auto; height: 2px; background: var(--text-dim); }
.target-card-body.tone-good::before { background: var(--success); }
.target-card-body.tone-warn::before { background: var(--warning); }
.target-card-body.tone-bad::before { background: var(--danger); }
.target-card-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.target-kind { padding: 4px 8px; color: var(--primary); font-size: 10px; font-weight: 800; letter-spacing: .08em; border: 1px solid color-mix(in srgb, var(--primary) 48%, transparent); border-radius: 6px; background: var(--primary-soft); }
.target-kind.kind-http { color: var(--warning); border-color: color-mix(in srgb, var(--warning) 48%, transparent); background: var(--warning-soft); }
.target-kind.kind-tcp { color: #38bdf8; }
.target-kind.kind-nat { color: #a78bfa; border-color: color-mix(in srgb, #a78bfa 48%, transparent); background: color-mix(in srgb, #a78bfa 12%, transparent); }
.target-state { display: inline-flex; align-items: center; gap: 6px; color: var(--text-muted); font-size: 11px; }
.target-state i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.target-state.good { color: var(--success); }.target-state.warn { color: var(--warning); }.target-state.bad { color: var(--danger); }
.target-title { display: block; width: fit-content; max-width: 100%; margin-top: 15px; overflow: hidden; color: var(--text); font-size: 16px; font-weight: 750; text-decoration: none; text-overflow: ellipsis; white-space: nowrap; }
.target-title:hover { color: var(--primary); }
.target-address { margin: 4px 0 0; overflow: hidden; color: var(--text-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.target-primary { display: block; margin-top: 20px; color: var(--text); font-size: 32px; line-height: 1; letter-spacing: -.04em; }
.tone-bad .target-primary { color: var(--danger); }
.target-details { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 18px; padding-top: 13px; border-top: 1px solid var(--border); }
.target-details span { display: grid; gap: 3px; }
.target-details small { color: var(--text-muted); font-size: 9px; }
.target-details b { font-size: 11px; font-weight: 700; }
.target-empty { margin: 18px 0 0; color: var(--text-muted); font-size: 11px; }
</style>
