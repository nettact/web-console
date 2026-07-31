<script setup lang="ts">
// Compact telemetry cell used by the Agent command-center list. The component
// keeps freshness visible, renders percentage metrics as scan-like tracks, and
// deliberately labels network direction instead of relying on arrow colour.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AgentResources } from '../../api'
import { fmtBytes, fmtBps } from '../../lib/format'
import { sampleAge } from '../../lib/agentStatusPage'

const props = defineProps<{
  kind: 'cpu' | 'memory' | 'disk' | 'net' | 'load' | 'uptime'
  resources: AgentResources
  now: number
}>()

const { t } = useI18n()

interface MetricCell {
  primary: string
  secondary?: string
  ts: string
  stale: boolean
  percent?: number
  tone: 'normal' | 'warn' | 'bad'
}

const metric = computed<MetricCell | null>(() => {
  const r = props.resources
  switch (props.kind) {
    case 'cpu':
      return r.cpu
        ? {
            primary: `${pct(r.cpu.value)}%`,
            ts: r.cpu.ts,
            stale: r.cpu.stale,
            percent: clamp(r.cpu.value),
            tone: usageTone(r.cpu.value),
          }
        : null
    case 'memory':
      return r.memory
        ? {
            primary: `${pct(r.memory.pct)}%`,
            secondary: r.memory.total ? `${fmtBytes(r.memory.used)} / ${fmtBytes(r.memory.total)}` : undefined,
            ts: r.memory.ts,
            stale: r.memory.stale,
            percent: clamp(r.memory.pct),
            tone: usageTone(r.memory.pct),
          }
        : null
    case 'disk': {
      if (!r.disk) return null
      const d = r.disk
      const capacity = d.total ? `${fmtBytes(d.used)} / ${fmtBytes(d.total)}` : diskSub(d.mount, d.mounts)
      return {
        primary: `${pct(d.pct)}%`,
        secondary: d.mounts > 1
          ? t('agentStatus.diskWorst', { pct: pct(d.pct), n: d.mounts })
          : capacity,
        ts: d.ts,
        stale: d.stale,
        percent: clamp(d.pct),
        tone: usageTone(d.pct),
      }
    }
    case 'load':
      return r.load
        ? {
            primary: load(r.load.load1),
            secondary: `${load(r.load.load5)} · ${load(r.load.load15)}`,
            ts: r.load.ts,
            stale: r.load.stale,
            tone: 'normal',
          }
        : null
    case 'uptime':
      return r.uptime
        ? {
            primary: formatUptime(r.uptime.value),
            ts: r.uptime.ts,
            stale: r.uptime.stale,
            tone: 'normal',
          }
        : null
    default:
      return null
  }
})

const network = computed(() => props.kind === 'net' ? props.resources.net : null)
const sample = computed(() => network.value ?? metric.value)

function pct(v: number): string {
  return v.toFixed(v >= 100 || v === Math.trunc(v) ? 0 : 1)
}
function load(v: number): string {
  return v.toFixed(2)
}
function clamp(v: number): number {
  return Math.max(0, Math.min(100, v))
}
function usageTone(v: number): 'normal' | 'warn' | 'bad' {
  if (v >= 90) return 'bad'
  if (v >= 75) return 'warn'
  return 'normal'
}
function diskSub(mount: string, mounts: number): string {
  return mounts > 1 ? t('agentStatus.diskMountN', { mount, n: mounts }) : mount
}
function formatUptime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return t('agentStatus.uptimeDH', { d, h })
  if (h > 0) return t('agentStatus.uptimeHM', { h, m })
  return t('agentStatus.uptimeM', { m })
}

const ageLabel = computed(() => {
  if (!sample.value) return ''
  const secs = sampleAge(sample.value.ts, props.now)
  if (secs == null) return ''
  if (secs < 60) return t('agentStatus.ageSeconds', { n: secs })
  if (secs < 3600) return t('agentStatus.ageMinutes', { n: Math.floor(secs / 60) })
  return t('agentStatus.ageHours', { n: Math.floor(secs / 3600) })
})
</script>

<template>
  <div v-if="kind === 'net' && network" class="telemetry network" :class="{ stale: network.stale }">
    <div class="network-line upload">
      <span class="direction">↑ {{ t('agentStatus.upload') }}</span>
      <strong>{{ fmtBps(network.tx_bps) }}</strong>
    </div>
    <div class="network-line download">
      <span class="direction">↓ {{ t('agentStatus.download') }}</span>
      <strong>{{ fmtBps(network.rx_bps) }}</strong>
    </div>
    <span v-if="network.stale" class="stale-tag">{{ t('agentStatus.stale') }}</span>
    <span class="sr-only">{{ ageLabel }}</span>
  </div>

  <div
    v-else-if="metric"
    class="telemetry"
    :class="[`tone-${metric.tone}`, `kind-${kind}`, { stale: metric.stale }]"
    :title="ageLabel"
  >
    <div class="metric-head">
      <strong>{{ metric.primary }}</strong>
      <span v-if="metric.stale" class="stale-tag">{{ t('agentStatus.stale') }}</span>
    </div>
    <div v-if="metric.percent != null" class="metric-track" aria-hidden="true">
      <i :style="{ width: `${metric.percent}%` }"></i>
    </div>
    <div v-else-if="kind === 'load'" class="load-wave" aria-hidden="true">
      <i></i><i></i><i></i><i></i><i></i><i></i>
    </div>
    <div v-if="metric.secondary" class="secondary">{{ metric.secondary }}</div>
  </div>

  <div v-else class="telemetry none" :title="t('agentStatus.noDataHint')">—</div>
</template>

<style scoped>
.telemetry { min-width: 0; color: var(--text); font-size: 11px; font-variant-numeric: tabular-nums; line-height: 1.25; }
.telemetry.none { color: var(--text-muted); font-size: 14px; }
.metric-head { display: flex; align-items: center; gap: 5px; }
.metric-head strong { overflow: hidden; font-family: var(--mono); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.metric-track { height: 5px; margin-top: 7px; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, var(--primary) 11%, var(--surface-2)); }
.metric-track i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--primary-strong), #22d3ee); box-shadow: 0 0 9px color-mix(in srgb, var(--primary) 65%, transparent); }
.tone-warn .metric-track i { background: linear-gradient(90deg, #f59e0b, var(--warning)); box-shadow: 0 0 9px color-mix(in srgb, var(--warning) 55%, transparent); }
.tone-bad .metric-track i { background: linear-gradient(90deg, #fb7185, var(--danger)); box-shadow: 0 0 9px color-mix(in srgb, var(--danger) 55%, transparent); }
.secondary { margin-top: 4px; overflow: hidden; color: var(--text-muted); font-family: var(--mono); font-size: 9.5px; text-overflow: ellipsis; white-space: nowrap; }
.kind-uptime .metric-head strong { font-size: 11.5px; white-space: normal; }
.load-wave { display: flex; align-items: end; gap: 2px; width: 42px; height: 8px; margin-top: 4px; }
.load-wave i { width: 2px; border-radius: 2px; background: var(--primary); }
.load-wave i:nth-child(1) { height: 3px; }
.load-wave i:nth-child(2) { height: 7px; }
.load-wave i:nth-child(3) { height: 4px; }
.load-wave i:nth-child(4) { height: 8px; }
.load-wave i:nth-child(5) { height: 5px; }
.load-wave i:nth-child(6) { height: 6px; }
.network { position: relative; display: grid; gap: 5px; }
.network-line { display: grid; grid-template-columns: 54px minmax(0, 1fr); align-items: center; gap: 5px; }
.network-line .direction { font-size: 10px; font-weight: 650; white-space: nowrap; }
.network-line strong { overflow: hidden; color: var(--text); font-family: var(--mono); font-size: 10.5px; text-overflow: ellipsis; white-space: nowrap; }
.network-line.download .direction { color: var(--color-info-text); }
.network-line.upload .direction { color: var(--color-accent-text); }
.telemetry.stale { opacity: .62; }
.stale-tag { flex: none; padding: 0 4px; color: var(--color-warning-text); font-size: 8.5px; font-weight: 600; border: 1px solid color-mix(in srgb, var(--warning) 35%, transparent); border-radius: 999px; background: var(--warning-soft); }
.network > .stale-tag { position: absolute; top: -4px; right: 0; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
</style>
