<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type MetricsSummary } from '../../api'
import { fmtNum, natCodeLabel, natTone } from '../../lib/metricMeta'
import { targetStatus } from '../../targetStatus'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  targetId: string
  targetKind: string
  agentId: string
  rangeSec?: number
}>(), { rangeSec: 0 })

const pageRangeSec = computed(() => props.rangeSec || ({
  '3h': 3 * 3600,
  '24h': 24 * 3600,
  '7d': 7 * 86400,
  '30d': 30 * 86400,
  '90d': 90 * 86400,
})[targetStatus.timeRange])

const latencyKinds: Record<string, string> = {
  icmp: 'probe.icmp.rtt_ms',
  gateway: 'probe.icmp.rtt_ms',
  dns: 'probe.dns.resolve_ms',
  http: 'probe.http.latency_ms',
  tcp: 'probe.tcp.connect_ms',
  nat: 'probe.nat.rtt_ms',
}

const propsLatencyKind = computed(() => latencyKinds[props.targetKind] || '')
const supportsLoss = computed(() => props.targetKind === 'icmp' || props.targetKind === 'gateway')
// Latest/P95 come pre-aggregated from raw retention. Wider page ranges are
// clamped to that retention boundary because percentiles of rollups are invalid.
const summary = ref<MetricsSummary | null>(null)
let loadSequence = 0

const kindLatest = (kind: string): number | null =>
  summary.value?.kinds[kind]?.latest?.value ?? null

const latency = computed(() => kindLatest(propsLatencyKind.value))
const latencyP95 = computed(() => summary.value?.kinds[propsLatencyKind.value]?.p95 ?? null)
const loss = computed(() => kindLatest('probe.icmp.loss_pct'))
const natType = computed(() => kindLatest('probe.nat.type'))
const hasPerformance = computed(() => latency.value != null || loss.value != null || natType.value != null)

const formatMs = (value: number | null): string => value == null ? '—' : `${fmtNum(value)} ms`
const formatPct = (value: number | null): string => value == null ? '—' : `${fmtNum(value)}%`

type PerformanceTone = '' | 'tone-attention' | 'tone-severe'
const latencyTone = (value: number | null): PerformanceTone => {
  if (value == null) return ''
  // ICMP/DNS measure a direct round trip or lookup. HTTP/TCP include service
  // work and handshakes, so use their established alert defaults (1000 ms) and
  // warn at half that. NAT binding RTT depends heavily on the chosen STUN server
  // and has no configured latency rule, so it stays neutral; NAT type carries
  // the meaningful severity instead.
  const thresholds = props.targetKind === 'http' || props.targetKind === 'tcp'
    ? { attention: 500, severe: 1000 }
    : props.targetKind === 'nat'
      ? null
      : { attention: 100, severe: 200 }
  if (!thresholds) return ''
  if (value >= thresholds.severe) return 'tone-severe'
  if (value >= thresholds.attention) return 'tone-attention'
  return ''
}
const lossTone = (value: number | null): PerformanceTone => {
  if (value == null) return ''
  if (value >= 5) return 'tone-severe'
  if (value > 0) return 'tone-attention'
  return ''
}
const natTypeTone = (value: number | null): PerformanceTone => {
  if (value == null) return ''
  const tone = natTone('probe.nat.type', value)
  if (tone === 'bad') return 'tone-severe'
  if (tone === 'unknown') return 'tone-attention'
  return ''
}

async function loadPerformance(): Promise<void> {
  const sequence = ++loadSequence
  const latencyKind = propsLatencyKind.value
  if (!latencyKind) {
    summary.value = null
    return
  }
  const kinds = [latencyKind]
  if (supportsLoss.value) kinds.push('probe.icmp.loss_pct')
  if (props.targetKind === 'nat') kinds.push('probe.nat.type')
  const result = await api
    .metricsSummary(props.agentId, kinds, { monitor: props.targetId, sinceSeconds: Math.min(pageRangeSec.value, 2 * 86400) })
    .catch(() => null)
  if (sequence !== loadSequence) return
  summary.value = result
}

watch([
  () => props.targetId,
  () => props.targetKind,
  () => props.agentId,
  pageRangeSec,
], loadPerformance)
onMounted(loadPerformance)
</script>

<template>
  <div v-if="hasPerformance" class="performance-facts">
    <div v-if="latency != null" class="performance-card" :class="latencyTone(latency)" data-test="latency">
      <span>{{ t('targetStatus.latency') }}</span>
      <strong>{{ formatMs(latency) }}</strong>
      <small>{{ t('targetStatus.latestLatencyHint') }}</small>
    </div>
    <div v-if="supportsLoss && loss != null" class="performance-card" :class="lossTone(loss)" data-test="loss">
      <span>{{ t('targetStatus.packetLoss') }}</span>
      <strong>{{ formatPct(loss) }}</strong>
      <small>{{ t('targetStatus.latestLossHint') }}</small>
    </div>
    <div v-if="latencyP95 != null" class="performance-card" :class="latencyTone(latencyP95)" data-test="p95">
      <span>{{ t('targetStatus.latencyP95') }}</span>
      <strong>{{ formatMs(latencyP95) }}</strong>
      <small>{{ t('targetStatus.p95WindowHint') }}</small>
    </div>
    <div v-if="natType != null" class="performance-card nat-type-card" :class="natTypeTone(natType)" data-test="nat-type">
      <span>{{ t('targetStatus.natType') }}</span>
      <strong>{{ natCodeLabel('probe.nat.type', natType) }}</strong>
      <small>{{ t('targetStatus.latestNatTypeHint') }}</small>
    </div>
  </div>
</template>

<style scoped>
.performance-facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 9px;
  margin-top: 9px;
}
.performance-card {
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--overlay-subtle);
}
.performance-card > span,
.performance-card strong,
.performance-card small { display: block; }
.performance-card > span {
  color: var(--text-muted);
  font-size: 9.5px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.performance-card strong { margin-top: 5px; color: var(--text-dim); font-size: 14px; }
.performance-card small { margin-top: 5px; color: var(--text-muted); font-size: 10.5px; }
.performance-card.tone-attention {
  border-color: color-mix(in oklch, var(--color-warning) 35%, transparent);
  background: var(--warning-soft);
}
.performance-card.tone-attention strong { color: var(--color-warning-text); }
.performance-card.tone-severe {
  border-color: color-mix(in oklch, var(--color-danger) 35%, transparent);
  background: var(--danger-soft);
}
.performance-card.tone-severe strong { color: var(--color-danger-text); }
.nat-type-card strong { font-size: 12.5px; overflow-wrap: anywhere; }

@media (max-width: 760px) {
  .performance-facts { grid-template-columns: 1fr; }
}
</style>
